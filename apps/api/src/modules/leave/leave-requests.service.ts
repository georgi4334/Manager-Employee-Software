import { Injectable } from '@nestjs/common';
import {
  LEAVE_MAX_FUTURE_YEARS,
  LEAVE_MAX_PAST_DAYS,
  addDays,
  countLeaveDays,
  daysByYear,
  remainingDays,
  yearOf,
  type CreateLeaveRequest,
  type DecisionRequest,
  type LeavePreview,
  type LeaveRequest,
  type LeaveRequestList,
  type LeaveRequestQuery,
  type PreviewLeaveRequest,
} from '@intime/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import { PermissionsService } from '../roles/permissions.service.js';
import { LeaveBalancesService } from './leave-balances.service.js';
import { LeaveSettingsService } from './leave-settings.service.js';
import { conflict, dateIn, dateOut, forbidden, invalid, notFound, num } from './leave.shared.js';

const REQUEST_SELECT = {
  id: true,
  employeeId: true,
  startDate: true,
  endDate: true,
  halfDayStart: true,
  halfDayEnd: true,
  days: true,
  reason: true,
  status: true,
  decidedAt: true,
  createdAt: true,
  employee: {
    select: { id: true, firstName: true, lastName: true, userId: true, managerId: true },
  },
  leaveType: { select: { id: true, key: true, name: true, color: true, isSick: true } },
  approvals: {
    select: { comment: true, decidedAt: true },
    orderBy: { decidedAt: 'desc' as const },
    take: 1,
  },
} satisfies Prisma.LeaveRequestSelect;

type Row = Prisma.LeaveRequestGetPayload<{ select: typeof REQUEST_SELECT }>;

interface ActorEmployee {
  id: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  status: string;
  country: string | null;
  hireDate: Date | null;
  managerId: string | null;
}

const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;

@Injectable()
export class LeaveRequestsService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly permissions: PermissionsService,
    private readonly balances: LeaveBalancesService,
    private readonly settings: LeaveSettingsService,
  ) {}

  // ----- preview and create --------------------------------------------------------------------

  preview(actor: RequestAuth, body: PreviewLeaveRequest): Promise<LeavePreview> {
    return this.db.tx(async (tx) => {
      const employee = await this.ownEmployee(tx, actor);
      const plan = await this.plan(tx, employee, body);
      return {
        days: plan.total,
        dates: plan.days.map((d) => ({ date: d.date, fraction: d.fraction })),
        remainingAfter: plan.remainingAfter,
        enough: plan.enough,
      };
    });
  }

  create(actor: RequestAuth, body: CreateLeaveRequest): Promise<LeaveRequest> {
    return this.db.tx(async (tx) => {
      const employee = await this.ownEmployee(tx, actor);
      await this.lockEmployee(tx, employee.id);
      const plan = await this.plan(tx, employee, body);
      if (plan.total === 0) {
        throw new AppException('NO_WORKING_DAYS', {
          message: 'The chosen dates contain no working day',
        });
      }
      if (!plan.enough) {
        throw new AppException('INSUFFICIENT_BALANCE', {
          message: 'Not enough leave days left',
          params: {
            available: plan.availableForLimit,
            requested: plan.limitedDays,
            year: plan.limitedYear,
          },
        });
      }
      const overlapping = await tx.leaveRequest.findFirst({
        where: {
          employeeId: employee.id,
          status: { in: ['pending', 'approved'] },
          startDate: { lte: dateIn(body.endDate) },
          endDate: { gte: dateIn(body.startDate) },
        },
        select: { id: true },
      });
      if (overlapping) throw conflict('dates', 'The dates overlap another leave request');

      const type = plan.type;
      const status = type.requiresApproval ? 'pending' : 'approved';
      let id: string;
      try {
        const created = await tx.leaveRequest.create({
          data: {
            employeeId: employee.id,
            leaveTypeId: type.id,
            startDate: dateIn(body.startDate),
            endDate: dateIn(body.endDate),
            halfDayStart: body.halfDayStart,
            halfDayEnd: body.halfDayEnd,
            days: plan.total,
            // Sick leave: never stored, whatever the client sent.
            reason: type.isSick ? null : (body.reason ?? null),
            status,
            decidedAt: status === 'approved' ? new Date() : null,
          },
          select: { id: true },
        });
        id = created.id;
      } catch (error) {
        if (String((error as Error).message).includes('leave_request_no_overlap')) {
          throw conflict('dates', 'The dates overlap another leave request');
        }
        throw error;
      }
      await tx.leaveRequestDay.createMany({
        data: plan.days.map((d) => ({ requestId: id, day: dateIn(d.date), fraction: d.fraction })),
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'leave.requested',
        entity: 'leave_request',
        entityId: id,
        after: {
          employeeId: employee.id,
          leaveTypeId: type.id,
          startDate: body.startDate,
          endDate: body.endDate,
          days: plan.total,
          status,
        },
      });
      const approvers = await this.approverUserIds(tx, employee);
      if (approvers.length > 0) {
        await this.outbox.publish(tx, 'leave.requested', {
          recipientUserIds: approvers,
          requestId: id,
          employeeName: fullName(employee),
          startDate: body.startDate,
          endDate: body.endDate,
          days: plan.total,
          autoApproved: status === 'approved',
        });
      }
      return this.one(tx, actor, id);
    });
  }

  // ----- reading -------------------------------------------------------------------------------

  list(actor: RequestAuth, query: LeaveRequestQuery): Promise<LeaveRequestList> {
    return this.db.tx(async (tx) => {
      const own = await tx.employee.findFirst({
        where: { userId: actor.userId },
        select: { id: true },
      });
      const everyone = (await tx.employee.findMany({ select: { id: true } })).map((e) => e.id);

      // The people whose requests the caller may see; "approvable" narrows it to those they may decide.
      let visible: Set<string> | null = null;
      if (actor.permissions['leave.view'] !== 'all') {
        visible = await this.authz.allowedEmployees(actor, 'leave.view', everyone);
      }
      let allowed: Set<string> | null = visible;
      if (query.approvable) {
        const approvable = await this.authz.allowedEmployees(actor, 'leave.approve', everyone);
        if (own) approvable.delete(own.id);
        allowed = visible ? new Set([...approvable].filter((id) => visible.has(id))) : approvable;
      }

      const where: Prisma.LeaveRequestWhereInput = {
        ...(allowed ? { employeeId: { in: [...allowed] } } : {}),
        ...(query.employeeId ? { AND: [{ employeeId: query.employeeId }] } : {}),
        ...(query.approvable
          ? { status: 'pending' }
          : query.status
            ? { status: query.status }
            : {}),
        ...(query.from ? { endDate: { gte: dateIn(query.from) } } : {}),
        ...(query.to ? { startDate: { lte: dateIn(query.to) } } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.leaveRequest.findMany({
          where,
          select: REQUEST_SELECT,
          orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.leaveRequest.count({ where }),
      ]);
      const items = await this.present(tx, actor, rows);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  // ----- decisions -----------------------------------------------------------------------------

  approve(actor: RequestAuth, id: string, body: DecisionRequest): Promise<LeaveRequest> {
    return this.decide(actor, id, 'approved', body);
  }

  reject(actor: RequestAuth, id: string, body: DecisionRequest): Promise<LeaveRequest> {
    return this.decide(actor, id, 'rejected', body);
  }

  private decide(
    actor: RequestAuth,
    id: string,
    decision: 'approved' | 'rejected',
    body: DecisionRequest,
  ): Promise<LeaveRequest> {
    return this.db.tx(async (tx) => {
      const approver = await this.ownEmployee(tx, actor);
      const row = await this.find(tx, id);
      // Nobody decides their own request, whatever their role: it goes to the next approver.
      if (row.employeeId === approver.id || row.employee.userId === actor.userId) {
        throw forbidden('You cannot decide your own leave request');
      }
      await this.authz.assert(actor, 'leave.approve', { ownerEmployeeId: row.employeeId });

      const changed = await tx.leaveRequest.updateMany({
        where: { id, status: 'pending' },
        data: { status: decision, decidedAt: new Date() },
      });
      if (changed.count !== 1) throw conflict('status', 'The request has already been decided');
      await tx.leaveApproval.create({
        data: {
          requestId: id,
          approverEmployeeId: approver.id,
          decision,
          comment: body.comment ?? null,
        },
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: decision === 'approved' ? 'leave.approved' : 'leave.rejected',
        entity: 'leave_request',
        entityId: id,
        after: { employeeId: row.employeeId, status: decision },
      });
      if (row.employee.userId) {
        await this.outbox.publish(tx, 'leave.decided', {
          recipientUserId: row.employee.userId,
          requestId: id,
          status: decision,
          startDate: dateOut(row.startDate),
          endDate: dateOut(row.endDate),
        });
      }
      return this.one(tx, actor, id);
    });
  }

  cancel(actor: RequestAuth, id: string, body: DecisionRequest): Promise<LeaveRequest> {
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, id);
      const today = await this.balances.today(tx);
      const isOwner = row.employee.userId === actor.userId;
      const start = dateOut(row.startDate);

      let byApprover = false;
      if (isOwner) {
        const mayCancel = row.status === 'pending' || (row.status === 'approved' && start > today);
        if (!mayCancel)
          throw conflict('status', 'This request can no longer be cancelled by its owner');
      } else {
        // Somebody else: only an approver whose scope reaches the requester.
        await this.authz.assert(actor, 'leave.approve', { ownerEmployeeId: row.employeeId });
        byApprover = true;
      }

      const wasApproved = row.status === 'approved';
      const changed = await tx.leaveRequest.updateMany({
        where: { id, status: { in: ['pending', 'approved'] } },
        data: { status: 'cancelled', decidedAt: new Date() },
      });
      if (changed.count !== 1) throw conflict('status', 'The request is already closed');
      const actorEmployee = await tx.employee.findFirst({
        where: { userId: actor.userId },
        select: { id: true },
      });
      if (actorEmployee) {
        await tx.leaveApproval.create({
          data: {
            requestId: id,
            approverEmployeeId: actorEmployee.id,
            decision: 'cancelled',
            comment: byApprover ? (body.comment ?? null) : null,
          },
        });
      }
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'leave.cancelled',
        entity: 'leave_request',
        entityId: id,
        after: { employeeId: row.employeeId, by: byApprover ? 'approver' : 'employee' },
      });

      const dates = { startDate: dateOut(row.startDate), endDate: dateOut(row.endDate) };
      if (byApprover && row.employee.userId) {
        await this.outbox.publish(tx, 'leave.cancelled', {
          recipientUserIds: [row.employee.userId],
          requestId: id,
          employeeName: fullName(row.employee),
          ...dates,
          by: 'approver',
        });
      } else if (!byApprover && wasApproved) {
        const approvers = await this.approverUserIds(tx, row.employee);
        if (approvers.length > 0) {
          await this.outbox.publish(tx, 'leave.cancelled', {
            recipientUserIds: approvers,
            requestId: id,
            employeeName: fullName(row.employee),
            ...dates,
            by: 'employee',
          });
        }
      }
      return this.one(tx, actor, id);
    });
  }

  // ----- helpers -------------------------------------------------------------------------------

  private async ownEmployee(tx: TenantTx, actor: RequestAuth): Promise<ActorEmployee> {
    const employee = await tx.employee.findFirst({
      where: { userId: actor.userId },
      select: {
        id: true,
        userId: true,
        firstName: true,
        lastName: true,
        status: true,
        country: true,
        hireDate: true,
        managerId: true,
      },
    });
    if (!employee || employee.status !== 'active') {
      throw notFound('Employee record');
    }
    return employee;
  }

  /** One request at a time per employee, so the balance check and the insert cannot interleave. */
  private async lockEmployee(tx: TenantTx, employeeId: string): Promise<void> {
    const tenantId = this.context.requireTenantId();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave-employee:${tenantId}:${employeeId}`}))`;
  }

  private async find(tx: TenantTx, id: string): Promise<Row> {
    const row = await tx.leaveRequest.findUnique({ where: { id }, select: REQUEST_SELECT });
    if (!row) throw notFound('Leave request');
    return row;
  }

  private async one(tx: TenantTx, actor: RequestAuth, id: string): Promise<LeaveRequest> {
    const [item] = await this.present(tx, actor, [await this.find(tx, id)]);
    if (!item) throw notFound('Leave request');
    return item;
  }

  /** Counted days, balance effect and checks shared by preview and create. */
  private async plan(
    tx: TenantTx,
    employee: ActorEmployee,
    body: Pick<
      PreviewLeaveRequest,
      'leaveTypeId' | 'startDate' | 'endDate' | 'halfDayStart' | 'halfDayEnd'
    >,
  ) {
    const type = await tx.leaveType.findUnique({
      where: { id: body.leaveTypeId },
      select: {
        id: true,
        isActive: true,
        tracksBalance: true,
        requiresApproval: true,
        isSick: true,
      },
    });
    if (!type || !type.isActive)
      throw invalid('leaveTypeId', 'unknown', 'Unknown or inactive leave type');

    const today = await this.balances.today(tx);
    if (body.startDate < addDays(today, -LEAVE_MAX_PAST_DAYS)) {
      throw invalid('startDate', 'too_far_in_past', 'The start is too far in the past');
    }
    const horizon = `${yearOf(today) + LEAVE_MAX_FUTURE_YEARS}${today.slice(4)}`;
    if (body.endDate > horizon)
      throw invalid('endDate', 'too_far_ahead', 'The end is too far ahead');

    const settings = await this.settings.settings(tx);
    const holidays = await this.settings.holidayMap(
      tx,
      employee.country ?? settings.defaultCountry,
      body.startDate,
      body.endDate < body.startDate ? body.startDate : body.endDate,
    );
    const counted = countLeaveDays({
      start: body.startDate,
      end: body.endDate,
      halfDayStart: body.halfDayStart,
      halfDayEnd: body.halfDayEnd,
      holidays,
    });
    if (!counted.ok) {
      const path = counted.problem === 'half_day_conflict' ? 'halfDayEnd' : 'endDate';
      throw invalid(path, counted.problem, 'The dates are not valid');
    }

    // Balance: every year the request touches must have enough left.
    let enough = true;
    let remainingAfter: number | null = null;
    let availableForLimit = 0;
    let limitedDays = 0;
    let limitedYear = yearOf(body.startDate);
    if (type.tracksBalance) {
      for (const [year, days] of daysByYear(counted.days)) {
        const figures = await this.balances.figures(tx, employee, type.id, year);
        const after = remainingDays({ ...figures, used: figures.used + days });
        if (remainingAfter === null || after < remainingAfter) remainingAfter = after;
        if (after < 0 && enough) {
          enough = false;
          availableForLimit = figures.remaining;
          limitedDays = days;
          limitedYear = year;
        }
      }
    }
    return {
      type,
      days: counted.days,
      total: counted.total,
      enough,
      remainingAfter,
      availableForLimit,
      limitedDays,
      limitedYear,
    };
  }

  /**
   * Who decides a request of this employee: their manager when that manager may approve, otherwise every
   * active person holding leave.approve for the whole workspace (HR/Admin). Never the requester.
   */
  private async approverUserIds(
    tx: TenantTx,
    employee: { id: string; userId: string | null; managerId: string | null },
  ): Promise<string[]> {
    if (employee.managerId) {
      const manager = await tx.employee.findUnique({
        where: { id: employee.managerId },
        select: { status: true, user: { select: { id: true, status: true } } },
      });
      if (manager?.status === 'active' && manager.user?.status === 'active') {
        const access = await this.permissions.forUser(tx, manager.user.id);
        const scope = access.permissions['leave.approve'];
        if (scope && scope !== 'own') return [manager.user.id];
      }
    }
    const everyone = await tx.user.findMany({
      where: {
        status: 'active',
        ...(employee.userId ? { id: { not: employee.userId } } : {}),
        roles: {
          some: {
            role: { permissions: { some: { permissionCode: 'leave.approve', scope: 'all' } } },
          },
        },
      },
      select: { id: true },
      take: 100,
    });
    return everyone.map((u) => u.id);
  }

  /** Turns rows into the API shape, applying privacy and the caller's abilities. */
  private async present(tx: TenantTx, actor: RequestAuth, rows: Row[]): Promise<LeaveRequest[]> {
    if (rows.length === 0) return [];
    const settings = await this.settings.settings(tx);
    const today = await this.balances.today(tx);
    const own = await tx.employee.findFirst({
      where: { userId: actor.userId },
      select: { id: true },
    });
    const approvable = await this.authz.allowedEmployees(actor, 'leave.approve', [
      ...new Set(rows.map((r) => r.employeeId)),
    ]);
    if (own) approvable.delete(own.id);
    const seesAllTypes = actor.permissions['leave.view'] === 'all';

    return rows.map((row) => {
      const isOwner = row.employee.userId === actor.userId;
      const isApprover = approvable.has(row.employeeId);
      const masked =
        settings.hideSickTypeFromTeam && row.leaveType.isSick && !isOwner && !seesAllTypes;
      const start = dateOut(row.startDate);
      const canSeeText = isOwner || isApprover;
      return {
        id: row.id,
        employee: {
          id: row.employee.id,
          firstName: row.employee.firstName,
          lastName: row.employee.lastName,
        },
        leaveType: masked
          ? null
          : {
              id: row.leaveType.id,
              key: row.leaveType.key as NonNullable<LeaveRequest['leaveType']>['key'],
              name: row.leaveType.name,
              color: row.leaveType.color as NonNullable<LeaveRequest['leaveType']>['color'],
              isSick: row.leaveType.isSick,
            },
        masked,
        startDate: start,
        endDate: dateOut(row.endDate),
        halfDayStart: row.halfDayStart,
        halfDayEnd: row.halfDayEnd,
        days: num(row.days),
        status: row.status as LeaveRequest['status'],
        reason: canSeeText ? row.reason : null,
        decisionComment: canSeeText ? (row.approvals[0]?.comment ?? null) : null,
        decidedAt: row.decidedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        canApprove: row.status === 'pending' && isApprover && !isOwner,
        canCancel:
          (isOwner && (row.status === 'pending' || (row.status === 'approved' && start > today))) ||
          (!isOwner && isApprover && (row.status === 'pending' || row.status === 'approved')),
      };
    });
  }
}
