import { Injectable } from '@nestjs/common';
import {
  DEFAULT_WEEK,
  MAX_SCHEDULE_ROWS,
  scheduleFor,
  type WorkSchedule,
  type WorkScheduleRequest,
  type WorkSchedules,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { workspaceToday } from '../projects/projects.present.js';
import { dateIn, dateOut, notFound } from '../projects/projects.shared.js';

/** Working hours per person (docs/adr/0026-working-hours.md): effective-dated weekly minutes. */
@Injectable()
export class SchedulesService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  /** The schedules of many people at once (Capacity). An empty list means the default week. */
  async forEmployees(
    tx: TenantTx,
    employeeIds: readonly string[],
  ): Promise<Map<string, WorkSchedule[]>> {
    const rows = employeeIds.length
      ? await tx.workSchedule.findMany({
          where: { employeeId: { in: [...employeeIds] } },
          select: { employeeId: true, validFrom: true, minutes: true },
          orderBy: { validFrom: 'asc' },
        })
      : [];
    const result = new Map<string, WorkSchedule[]>();
    for (const row of rows) {
      const list = result.get(row.employeeId) ?? [];
      list.push({ validFrom: dateOut(row.validFrom), minutes: row.minutes });
      result.set(row.employeeId, list);
    }
    return result;
  }

  get(actor: RequestAuth, employeeId: string): Promise<WorkSchedules> {
    return this.db.tx(async (tx) => {
      await this.visible(tx, actor, employeeId);
      return this.present(tx, actor, employeeId);
    });
  }

  set(actor: RequestAuth, employeeId: string, body: WorkScheduleRequest): Promise<WorkSchedules> {
    return this.db.tx(async (tx) => {
      await this.exists(tx, employeeId);
      const validFrom = dateIn(body.validFrom);
      const existing = await tx.workSchedule.findFirst({ where: { employeeId, validFrom } });
      if (!existing) {
        const count = await tx.workSchedule.count({ where: { employeeId } });
        if (count >= MAX_SCHEDULE_ROWS) {
          throw new AppException('CONFLICT', {
            message: 'Too many schedule changes for one person',
            params: { field: 'limit' },
          });
        }
      }
      const saved = existing
        ? await tx.workSchedule.update({
            where: { id: existing.id },
            data: { minutes: body.minutes },
          })
        : await tx.workSchedule.create({
            data: { employeeId, validFrom, minutes: body.minutes },
          });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'employee.schedule_set',
        entity: 'work_schedule',
        entityId: saved.id,
        after: { employeeId, validFrom: body.validFrom },
      });
      return this.present(tx, actor, employeeId);
    });
  }

  remove(actor: RequestAuth, employeeId: string, scheduleId: string): Promise<WorkSchedules> {
    return this.db.tx(async (tx) => {
      await this.exists(tx, employeeId);
      const row = await tx.workSchedule.findFirst({ where: { id: scheduleId, employeeId } });
      if (!row) throw notFound('Schedule');
      await tx.workSchedule.delete({ where: { id: row.id } });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'employee.schedule_removed',
        entity: 'work_schedule',
        entityId: row.id,
        after: { employeeId, validFrom: dateOut(row.validFrom) },
      });
      return this.present(tx, actor, employeeId);
    });
  }

  private async exists(tx: TenantTx, employeeId: string): Promise<void> {
    const found = await tx.employee.findFirst({ where: { id: employeeId }, select: { id: true } });
    if (!found) throw notFound('Employee');
  }

  /** A person the caller may not see at full profile level is `404`, like their profile. */
  private async visible(tx: TenantTx, actor: RequestAuth, employeeId: string): Promise<void> {
    await this.exists(tx, employeeId);
    const allowed = await this.authz.can(actor, 'employee.view_profile_full', {
      ownerEmployeeId: employeeId,
    });
    if (!allowed) throw notFound('Employee');
  }

  private async present(
    tx: TenantTx,
    actor: RequestAuth,
    employeeId: string,
  ): Promise<WorkSchedules> {
    const rows = await tx.workSchedule.findMany({
      where: { employeeId },
      orderBy: { validFrom: 'desc' },
    });
    const today = await workspaceToday(tx, this.context);
    const schedules = rows.map((r) => ({
      id: r.id,
      validFrom: dateOut(r.validFrom),
      minutes: r.minutes,
    }));
    const inForce = scheduleFor(schedules, today);
    return {
      employeeId,
      effective: [...(inForce?.minutes ?? DEFAULT_WEEK)],
      isDefault: inForce === null,
      items: schedules.map((s) => ({ ...s, current: s.id === inForce?.id })),
      canManage: Boolean(actor.permissions['employee.manage_schedule']),
    };
  }
}
