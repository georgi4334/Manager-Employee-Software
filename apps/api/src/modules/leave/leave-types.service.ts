import { Injectable } from '@nestjs/common';
import {
  SYSTEM_LEAVE_TYPES,
  SYSTEM_LEAVE_TYPE_KEYS,
  type CreateLeaveTypeRequest,
  type LeaveType,
  type UpdateLeaveTypeRequest,
} from '@intime/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { conflict, forbidden, invalid, notFound, num } from './leave.shared.js';

const SELECT = {
  id: true,
  key: true,
  name: true,
  tracksBalance: true,
  requiresApproval: true,
  isSick: true,
  color: true,
  isActive: true,
  policy: { select: { annualAllowanceDays: true, carryOverMaxDays: true } },
} satisfies Prisma.LeaveTypeSelect;

type Row = Prisma.LeaveTypeGetPayload<{ select: typeof SELECT }>;

export const toLeaveType = (row: Row): LeaveType => ({
  id: row.id,
  key: row.key as LeaveType['key'],
  name: row.name,
  tracksBalance: row.tracksBalance,
  requiresApproval: row.requiresApproval,
  isSick: row.isSick,
  color: row.color as LeaveType['color'],
  isActive: row.isActive,
  allowanceDays: row.policy ? num(row.policy.annualAllowanceDays) : null,
  carryOverMaxDays: row.policy ? num(row.policy.carryOverMaxDays) : null,
});

/** Fields of a system type that HR may not change: they define what the type means. */
const SYSTEM_LOCKED = ['name', 'tracksBalance', 'isSick'] as const;

@Injectable()
export class LeaveTypesService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly audit: AuditService,
  ) {}

  /** The four system types, the annual allowance and the settings row of a workspace. Idempotent. */
  async ensureDefaults(tx: TenantTx): Promise<void> {
    for (const key of SYSTEM_LEAVE_TYPE_KEYS) {
      const def = SYSTEM_LEAVE_TYPES[key];
      const existing = await tx.leaveType.findFirst({ where: { key }, select: { id: true } });
      if (existing) continue;
      const created = await tx.leaveType.create({
        data: {
          key,
          tracksBalance: def.tracksBalance,
          requiresApproval: def.requiresApproval,
          isSick: def.isSick,
          color: def.color,
        },
        select: { id: true },
      });
      if (def.allowanceDays !== null) {
        await tx.leavePolicy.create({
          data: {
            leaveTypeId: created.id,
            annualAllowanceDays: def.allowanceDays,
            carryOverMaxDays: def.carryOverMaxDays ?? 0,
          },
        });
      }
    }
    if (!(await tx.leaveSettings.findFirst({ select: { tenantId: true } }))) {
      await tx.leaveSettings.create({ data: {} });
    }
  }

  list(actor: RequestAuth): Promise<LeaveType[]> {
    const manager = actor.permissions['leave.manage_types_policies'] !== undefined;
    return this.db.tx(async (tx) => {
      const rows = await tx.leaveType.findMany({
        where: manager ? {} : { isActive: true },
        select: SELECT,
        orderBy: [{ key: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
      });
      return rows.map(toLeaveType);
    });
  }

  create(actor: RequestAuth, body: CreateLeaveTypeRequest): Promise<LeaveType> {
    return this.db.tx(async (tx) => {
      await this.assertNameFree(tx, body.name);
      if (body.tracksBalance && body.isSick) {
        throw invalid(
          'isSick',
          'sick_without_balance',
          'Sick leave cannot have a yearly allowance',
        );
      }
      const created = await tx.leaveType.create({
        data: {
          name: body.name,
          tracksBalance: body.tracksBalance,
          requiresApproval: body.requiresApproval,
          isSick: body.isSick,
          color: body.color,
          ...(body.tracksBalance
            ? {
                policy: {
                  create: {
                    annualAllowanceDays: body.allowanceDays ?? 0,
                    carryOverMaxDays: body.carryOverMaxDays ?? 0,
                  },
                },
              }
            : {}),
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'leave.type_created',
        entity: 'leave_type',
        entityId: created.id,
        after: {
          tracksBalance: body.tracksBalance,
          requiresApproval: body.requiresApproval,
          isSick: body.isSick,
        },
      });
      return this.one(tx, created.id);
    });
  }

  update(actor: RequestAuth, id: string, body: UpdateLeaveTypeRequest): Promise<LeaveType> {
    return this.db.tx(async (tx) => {
      const current = await tx.leaveType.findUnique({ where: { id }, select: SELECT });
      if (!current) throw notFound('Leave type');

      if (current.key) {
        for (const field of SYSTEM_LOCKED) {
          if (body[field] !== undefined && body[field] !== current[field]) {
            throw forbidden(`The ${field} of a system leave type cannot be changed`);
          }
        }
      }
      const nextTracks = body.tracksBalance ?? current.tracksBalance;
      const nextSick = body.isSick ?? current.isSick;
      if (nextTracks && nextSick) {
        throw invalid(
          'isSick',
          'sick_without_balance',
          'Sick leave cannot have a yearly allowance',
        );
      }
      // Changing what a type means after people have used it would rewrite history.
      if (
        (body.tracksBalance !== undefined && body.tracksBalance !== current.tracksBalance) ||
        (body.isSick !== undefined && body.isSick !== current.isSick)
      ) {
        if (await tx.leaveRequest.count({ where: { leaveTypeId: id } })) {
          throw conflict('in_use', 'The type already has requests');
        }
      }
      if (
        body.name !== undefined &&
        body.name.toLowerCase() !== (current.name ?? '').toLowerCase()
      ) {
        await this.assertNameFree(tx, body.name, id);
      }

      const { allowanceDays, carryOverMaxDays, ...fields } = body;
      await tx.leaveType.update({ where: { id }, data: fields });
      if (nextTracks) {
        const allowance =
          allowanceDays ?? (current.policy ? num(current.policy.annualAllowanceDays) : 0);
        const carry =
          carryOverMaxDays ?? (current.policy ? num(current.policy.carryOverMaxDays) : 0);
        await tx.leavePolicy.upsert({
          where: {
            tenantId_leaveTypeId: { tenantId: this.context.requireTenantId(), leaveTypeId: id },
          },
          create: { leaveTypeId: id, annualAllowanceDays: allowance, carryOverMaxDays: carry },
          update: { annualAllowanceDays: allowance, carryOverMaxDays: carry },
        });
      }
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'leave.type_updated',
        entity: 'leave_type',
        entityId: id,
        after: body as Prisma.InputJsonObject,
      });
      return this.one(tx, id);
    });
  }

  private async one(tx: TenantTx, id: string): Promise<LeaveType> {
    return toLeaveType(await tx.leaveType.findUniqueOrThrow({ where: { id }, select: SELECT }));
  }

  private async assertNameFree(tx: TenantTx, name: string, exceptId?: string): Promise<void> {
    const taken = await tx.leaveType.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (taken) throw conflict('name', 'A leave type with this name exists');
  }
}
