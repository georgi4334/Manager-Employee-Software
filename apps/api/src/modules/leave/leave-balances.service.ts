import { Injectable } from '@nestjs/common';
import {
  carryOver,
  proratedAllowance,
  remainingDays,
  sum,
  todayIn,
  yearOf,
  type AdjustBalanceRequest,
  type BalanceQuery,
  type LeaveBalance,
  type LeaveBalances,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { dateOut, forbidden, invalid, notFound, num } from './leave.shared.js';

interface EmployeeRef {
  id: string;
  hireDate: Date | null;
}

/** Yearly leave balances (docs/adr/0008-leave.md section 3). */
@Injectable()
export class LeaveBalancesService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  /** Today's date in the workspace's time zone. */
  async today(tx: TenantTx): Promise<string> {
    const tenant = await tx.tenant.findUnique({
      where: { id: this.context.requireTenantId() },
      select: { defaultTimezone: true },
    });
    return todayIn(tenant?.defaultTimezone ?? 'UTC');
  }

  /** Counted days that are used (approved) or pending in one calendar year. */
  async usage(
    tx: TenantTx,
    employeeId: string,
    leaveTypeId: string,
    year: number,
  ): Promise<{ used: number; pending: number }> {
    const rows = await tx.$queryRaw<{ status: string; days: string | null }[]>`
      SELECT r.status, SUM(d.fraction)::text AS days
        FROM leave_request_day d
        JOIN leave_request r ON r.id = d.request_id AND r.tenant_id = d.tenant_id
       WHERE r.employee_id = ${employeeId}::uuid AND r.leave_type_id = ${leaveTypeId}::uuid
         AND r.status IN ('pending', 'approved')
         AND d.day >= make_date(${year}, 1, 1) AND d.day <= make_date(${year}, 12, 31)
       GROUP BY r.status`;
    const days = (status: string) => num(rows.find((row) => row.status === status)?.days);
    return { used: days('approved'), pending: days('pending') };
  }

  /**
   * The balance row of (employee, type, year); created on first use from the policy and then frozen. The
   * carry-over comes from last year's row when it exists.
   */
  async ensure(
    tx: TenantTx,
    employee: EmployeeRef,
    leaveTypeId: string,
    year: number,
  ): Promise<{ entitled: number; carriedOver: number; adjustment: number }> {
    const key = { employeeId: employee.id, leaveTypeId, year };
    const read = async () => {
      const row = await tx.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_year: key },
      });
      return row
        ? {
            entitled: num(row.entitled),
            carriedOver: num(row.carriedOver),
            adjustment: num(row.adjustment),
          }
        : null;
    };
    const existing = await read();
    if (existing) return existing;

    const policy = await tx.leavePolicy.findFirst({ where: { leaveTypeId } });
    const allowance = policy ? num(policy.annualAllowanceDays) : 0;
    const cap = policy ? num(policy.carryOverMaxDays) : 0;
    let carried = 0;
    const previous = await tx.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { ...key, year: year - 1 } },
    });
    if (previous) {
      const usage = await this.usage(tx, employee.id, leaveTypeId, year - 1);
      carried = carryOver(
        remainingDays({
          entitled: num(previous.entitled),
          carriedOver: num(previous.carriedOver),
          adjustment: num(previous.adjustment),
          ...usage,
        }),
        cap,
      );
    }
    await tx.leaveBalance.createMany({
      data: [
        {
          ...key,
          entitled: proratedAllowance(
            allowance,
            employee.hireDate ? dateOut(employee.hireDate) : null,
            year,
          ),
          carriedOver: carried,
        },
      ],
      skipDuplicates: true,
    });
    return (await read()) ?? { entitled: 0, carriedOver: 0, adjustment: 0 };
  }

  /** All figures of one balance. */
  async figures(
    tx: TenantTx,
    employee: EmployeeRef,
    leaveTypeId: string,
    year: number,
  ): Promise<LeaveBalance> {
    const base = await this.ensure(tx, employee, leaveTypeId, year);
    const usage = await this.usage(tx, employee.id, leaveTypeId, year);
    return {
      leaveTypeId,
      year,
      ...base,
      ...usage,
      remaining: remainingDays({ ...base, ...usage }),
    };
  }

  // ----- endpoints -----------------------------------------------------------------------------

  list(actor: RequestAuth, query: BalanceQuery): Promise<LeaveBalances> {
    return this.db.tx(async (tx) => {
      const own = await tx.employee.findFirst({
        where: { userId: actor.userId },
        select: { id: true, hireDate: true },
      });
      const target =
        query.employeeId && query.employeeId !== own?.id
          ? await tx.employee.findUnique({
              where: { id: query.employeeId },
              select: { id: true, hireDate: true },
            })
          : own;
      if (!target) throw notFound('Employee');
      // Own figures need the permission at any scope; other people's need the scope to reach them.
      await this.authz.assert(actor, 'leave.view_balance', { ownerEmployeeId: target.id });

      const year = query.year ?? yearOf(await this.today(tx));
      const types = await tx.leaveType.findMany({
        where: { tracksBalance: true, isActive: true },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      const balances: LeaveBalance[] = [];
      for (const type of types) balances.push(await this.figures(tx, target, type.id, year));
      return { employeeId: target.id, year, balances };
    });
  }

  adjust(actor: RequestAuth, body: AdjustBalanceRequest): Promise<LeaveBalance> {
    return this.db.tx(async (tx) => {
      if (actor.permissions['leave.adjust_balance'] !== 'all')
        throw forbidden('Not allowed: leave.adjust_balance');
      const employee = await tx.employee.findUnique({
        where: { id: body.employeeId },
        select: { id: true, hireDate: true, status: true },
      });
      if (!employee) throw notFound('Employee');
      const type = await tx.leaveType.findUnique({
        where: { id: body.leaveTypeId },
        select: { id: true, tracksBalance: true },
      });
      if (!type) throw notFound('Leave type');
      if (!type.tracksBalance) {
        throw invalid('leaveTypeId', 'no_balance', 'This leave type has no balance to adjust');
      }

      const current = await this.ensure(tx, employee, type.id, body.year);
      const total = sum([current.entitled, current.carriedOver, current.adjustment, body.delta]);
      if (total < 0)
        throw invalid('delta', 'below_zero', 'The yearly allowance cannot become negative');
      await tx.leaveBalance.update({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: employee.id,
            leaveTypeId: type.id,
            year: body.year,
          },
        },
        data: { adjustment: { increment: body.delta } },
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'leave.balance_adjusted',
        entity: 'employee',
        entityId: employee.id,
        after: { leaveTypeId: type.id, year: body.year, delta: body.delta },
      });
      return this.figures(tx, employee, type.id, body.year);
    });
  }
}
