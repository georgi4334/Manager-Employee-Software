import { Injectable } from '@nestjs/common';
import {
  MAX_COMPENSATION_ROWS,
  compensationFor,
  type Compensation,
  type CompensationBasis,
  type CompensationCurrency,
  type CompensationRequest,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { workspaceToday } from '../projects/projects.present.js';
import { dateIn, dateOut, notFound } from '../projects/projects.shared.js';

/**
 * Pay records (docs/adr/0030-compensation.md): HR and Admin only, effective-dated, never computed on. Amounts
 * are never logged, audited or put in an error.
 */
@Injectable()
export class CompensationService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  get(actor: RequestAuth, employeeId: string): Promise<Compensation> {
    return this.db.tx(async (tx) => {
      await this.exists(tx, employeeId);
      await this.authz.assert(actor, 'compensation.view', { ownerEmployeeId: employeeId });
      return this.present(tx, actor, employeeId);
    });
  }

  set(actor: RequestAuth, employeeId: string, body: CompensationRequest): Promise<Compensation> {
    return this.db.tx(async (tx) => {
      await this.exists(tx, employeeId);
      await this.authz.assert(actor, 'compensation.manage', { ownerEmployeeId: employeeId });
      await this.notOwn(tx, actor, employeeId);
      const validFrom = dateIn(body.validFrom);
      const existing = await tx.compensation.findFirst({ where: { employeeId, validFrom } });
      if (!existing) {
        const count = await tx.compensation.count({ where: { employeeId } });
        if (count >= MAX_COMPENSATION_ROWS) {
          throw new AppException('CONFLICT', {
            message: 'Too many compensation changes for one person',
            params: { field: 'limit' },
          });
        }
      }
      const data = {
        basis: body.basis,
        amountMinor: BigInt(body.amountMinor),
        currency: body.currency,
      };
      const saved = existing
        ? await tx.compensation.update({ where: { id: existing.id }, data })
        : await tx.compensation.create({ data: { employeeId, validFrom, ...data } });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'compensation.set',
        entity: 'compensation',
        entityId: saved.id,
        after: {
          employeeId,
          validFrom: body.validFrom,
          basis: body.basis,
          currency: body.currency,
        },
      });
      return this.present(tx, actor, employeeId);
    });
  }

  remove(actor: RequestAuth, employeeId: string, rowId: string): Promise<Compensation> {
    return this.db.tx(async (tx) => {
      await this.exists(tx, employeeId);
      await this.authz.assert(actor, 'compensation.manage', { ownerEmployeeId: employeeId });
      await this.notOwn(tx, actor, employeeId);
      const row = await tx.compensation.findFirst({ where: { id: rowId, employeeId } });
      if (!row) throw notFound('Compensation');
      await tx.compensation.delete({ where: { id: row.id } });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'compensation.removed',
        entity: 'compensation',
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

  /** Nobody changes their own pay, whatever the role. */
  private async notOwn(tx: TenantTx, actor: RequestAuth, employeeId: string): Promise<void> {
    const own = await tx.employee.findFirst({
      where: { userId: actor.userId },
      select: { id: true },
    });
    if (own?.id === employeeId) {
      throw new AppException('FORBIDDEN', {
        message: 'Nobody changes their own compensation',
      });
    }
  }

  private async present(
    tx: TenantTx,
    actor: RequestAuth,
    employeeId: string,
  ): Promise<Compensation> {
    const rows = await tx.compensation.findMany({
      where: { employeeId },
      orderBy: { validFrom: 'desc' },
    });
    const today = await workspaceToday(tx, this.context);
    const items = rows.map((r) => ({
      id: r.id,
      validFrom: dateOut(r.validFrom),
      basis: r.basis as CompensationBasis,
      amountMinor: Number(r.amountMinor),
      currency: r.currency as CompensationCurrency,
    }));
    const inForce = compensationFor(items, today);
    return {
      employeeId,
      items: items.map((i) => ({ ...i, current: i.id === inForce?.id })),
      canManage: Boolean(actor.permissions['compensation.manage']),
    };
  }
}
