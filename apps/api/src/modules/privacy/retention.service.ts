import { Injectable } from '@nestjs/common';
import {
  RETENTION_PREVIEW_DAYS,
  RETENTION_PREVIEW_LIMIT,
  RETENTION_PRESETS,
  isRetentionDue,
  retentionDueDate,
  type RetentionOverview,
  type RetentionPolicy,
  type UpdateRetentionRequest,
} from '@intime/contracts';
import { addDays } from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AppException } from '../../common/errors/app-exception.js';
import type { TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantContext } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { workspaceToday } from '../projects/projects.present.js';
import { dateOut } from '../projects/projects.shared.js';

/** The workspace's retention policy: none stored means the Bulgarian preset, switched off (docs/adr/0027). */
export async function loadPolicy(tx: TenantTx): Promise<RetentionPolicy> {
  const row = await tx.retentionPolicy.findFirst();
  const presetMonths = RETENTION_PRESETS.BG.formerEmployeeMonths;
  return {
    country: 'BG',
    enabled: row?.enabled ?? false,
    formerEmployeeMonths: row?.formerEmployeeMonths ?? presetMonths,
    lastRunAt: row?.lastRunAt?.toISOString() ?? null,
    lastRunErased: row?.lastRunErased ?? 0,
    presetMonths,
  };
}

@Injectable()
export class RetentionService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly audit: AuditService,
  ) {}

  overview(): Promise<RetentionOverview> {
    return this.db.tx((tx) => this.build(tx));
  }

  private async build(tx: TenantTx): Promise<RetentionOverview> {
    const policy = await loadPolicy(tx);
    const today = await workspaceToday(tx, this.context);
    // Inactive people with a termination date inside the preview window (or already past it).
    const horizon = addDays(today, RETENTION_PREVIEW_DAYS);
    const rows = await tx.employee.findMany({
      where: { status: 'inactive', erasedAt: null, terminationDate: { not: null } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        terminationDate: true,
        retentionHold: true,
      },
      orderBy: [{ terminationDate: 'asc' }, { id: 'asc' }],
    });
    const candidates = rows
      .map((r) => {
        const termination = dateOut(r.terminationDate!);
        const dueDate = retentionDueDate(termination, policy.formerEmployeeMonths);
        return {
          employeeId: r.id,
          name: `${r.firstName} ${r.lastName}`,
          terminationDate: termination,
          dueDate,
          due: isRetentionDue(termination, policy.formerEmployeeMonths, today),
          held: r.retentionHold,
        };
      })
      .filter((c) => c.dueDate <= horizon)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name))
      .slice(0, RETENTION_PREVIEW_LIMIT);
    const withoutTerminationDate = await tx.employee.count({
      where: { status: 'inactive', erasedAt: null, terminationDate: null },
    });
    return { policy, today, candidates, withoutTerminationDate };
  }

  update(actor: RequestAuth, body: UpdateRetentionRequest): Promise<RetentionOverview> {
    return this.db.tx(async (tx) => {
      const current = await tx.retentionPolicy.findFirst();
      const data = {
        country: body.country ?? 'BG',
        enabled: body.enabled ?? current?.enabled ?? false,
        formerEmployeeMonths:
          body.formerEmployeeMonths ??
          current?.formerEmployeeMonths ??
          RETENTION_PRESETS.BG.formerEmployeeMonths,
      };
      if (current) await tx.retentionPolicy.update({ where: { id: current.id }, data });
      else await tx.retentionPolicy.create({ data });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'privacy.retention_updated',
        entity: 'retention_policy',
        after: {
          country: data.country,
          enabled: data.enabled,
          formerEmployeeMonths: data.formerEmployeeMonths,
        },
      });
      return this.build(tx);
    });
  }

  hold(actor: RequestAuth, employeeId: string, held: boolean): Promise<RetentionOverview> {
    return this.db.tx(async (tx) => {
      const found = await tx.employee.findFirst({
        where: { id: employeeId },
        select: { id: true },
      });
      if (!found) throw new AppException('NOT_FOUND', { message: 'Employee not found' });
      await tx.employee.update({ where: { id: employeeId }, data: { retentionHold: held } });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: held ? 'privacy.retention_hold_set' : 'privacy.retention_hold_released',
        entity: 'employee',
        entityId: employeeId,
      });
      return this.build(tx);
    });
  }
}
