import { Injectable } from '@nestjs/common';
import {
  addDays,
  isWeekStart,
  weekStartOf,
  type SubmitTimesheetRequest,
  type Timesheet,
  type TimesheetList,
  type TimesheetQuery,
  type TimesheetStatus,
  type TimeWeek,
} from '@intime/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import { workspaceToday } from '../projects/projects.present.js';
import {
  conflict,
  dateIn,
  dateOut,
  forbidden,
  invalid,
  notFound,
} from '../projects/projects.shared.js';
import { TimeService } from './time.service.js';
import { lockEmployee } from './time.shared.js';

const SELECT = {
  id: true,
  employeeId: true,
  weekStart: true,
  status: true,
  submittedAt: true,
  decidedAt: true,
  employee: { select: { id: true, firstName: true, lastName: true, userId: true } },
} satisfies Prisma.TimesheetSelect;
type Row = Prisma.TimesheetGetPayload<{ select: typeof SELECT }>;

/** Weekly timesheets: submit, approve or send back, reopen (docs/adr/0015-time-tracker.md). */
@Injectable()
export class TimesheetsService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
    private readonly time: TimeService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  submit(actor: RequestAuth, body: SubmitTimesheetRequest): Promise<Timesheet> {
    return this.db.tx(async (tx) => {
      const me = await this.ownEmployeeId(tx, actor);
      if (!isWeekStart(body.weekStart)) {
        throw invalid('weekStart', 'not_a_monday', 'A week starts on a Monday');
      }
      const today = await workspaceToday(tx, this.context);
      if (body.weekStart > weekStartOf(today)) {
        throw invalid(
          'weekStart',
          'future_week',
          'A week that has not started cannot be submitted',
        );
      }
      await lockEmployee(tx, this.context, me);
      const existing = await tx.timesheet.findFirst({
        where: { employeeId: me, weekStart: dateIn(body.weekStart) },
        select: { id: true, status: true },
      });
      if (existing && (existing.status === 'submitted' || existing.status === 'approved')) {
        throw conflict('locked', 'This week is already submitted');
      }
      const range = {
        employeeId: me,
        workDate: { gte: dateIn(body.weekStart), lte: dateIn(addDays(body.weekStart, 6)) },
      };
      if (
        await tx.timeEntry.findFirst({ where: { ...range, minutes: null }, select: { id: true } })
      ) {
        throw invalid('weekStart', 'timer_running', 'Stop the running timer first');
      }
      if (!(await tx.timeEntry.findFirst({ where: range, select: { id: true } }))) {
        throw invalid('weekStart', 'no_entries', 'There is no time logged in this week');
      }
      const data = {
        status: 'submitted',
        submittedAt: new Date(),
        decidedByEmployeeId: null,
        decidedAt: null,
      };
      const sheet = existing
        ? await tx.timesheet.update({ where: { id: existing.id }, data, select: SELECT })
        : await tx.timesheet.create({
            data: { ...data, employeeId: me, weekStart: dateIn(body.weekStart) },
            select: SELECT,
          });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'timesheet.submitted',
        entity: 'timesheet',
        entityId: sheet.id,
        after: { weekStart: body.weekStart },
      });
      return (await this.present(tx, actor, [sheet], me))[0]!;
    });
  }

  list(actor: RequestAuth, query: TimesheetQuery): Promise<TimesheetList> {
    return this.db.tx(async (tx) => {
      const me = await tx.employee.findFirst({
        where: { userId: actor.userId, status: 'active' },
        select: { id: true },
      });
      const everyone = (
        await tx.employee.findMany({
          where: me ? { id: { not: me.id } } : {},
          select: { id: true },
        })
      ).map((e) => e.id);
      const allowed = [
        ...(await this.authz.allowedEmployees(actor, 'timesheet.approve', everyone)),
      ];
      const where: Prisma.TimesheetWhereInput = {
        employeeId: { in: allowed },
        ...(query.status === 'all' ? {} : { status: query.status }),
      };
      const [rows, total] = await Promise.all([
        tx.timesheet.findMany({
          where,
          select: SELECT,
          orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.timesheet.count({ where }),
      ]);
      return {
        items: await this.present(tx, actor, rows, me?.id ?? null),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  /** The entries behind a sheet, for the person who decides on it. */
  detail(actor: RequestAuth, id: string): Promise<TimeWeek> {
    return this.db.tx(async (tx) => {
      const sheet = await this.findInScope(tx, actor, id);
      const today = await workspaceToday(tx, this.context);
      return this.time.weekOf(tx, actor, sheet.employeeId, dateOut(sheet.weekStart), false, today);
    });
  }

  approve(actor: RequestAuth, id: string): Promise<Timesheet> {
    return this.decide(actor, id, 'approved');
  }
  reject(actor: RequestAuth, id: string): Promise<Timesheet> {
    return this.decide(actor, id, 'rejected');
  }

  reopen(actor: RequestAuth, id: string): Promise<Timesheet> {
    return this.db.tx(async (tx) => {
      const sheet = await tx.timesheet.findUnique({ where: { id }, select: SELECT });
      if (!sheet) throw notFound('Timesheet');
      const me = await this.ownEmployeeId(tx, actor);
      await this.authz.assert(actor, 'timesheet.reopen', { ownerEmployeeId: sheet.employeeId });
      if (sheet.employeeId === me) throw forbidden('Nobody reopens their own timesheet');
      await lockEmployee(tx, this.context, sheet.employeeId);
      const fresh = await tx.timesheet.findUnique({ where: { id }, select: SELECT });
      if (fresh?.status !== 'approved')
        throw conflict('status', 'Only an approved timesheet can be reopened');
      const updated = await tx.timesheet.update({
        where: { id },
        data: { status: 'open', decidedByEmployeeId: null, decidedAt: null },
        select: SELECT,
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'timesheet.reopened',
        entity: 'timesheet',
        entityId: id,
        after: { weekStart: dateOut(sheet.weekStart), employeeId: sheet.employeeId },
      });
      return (await this.present(tx, actor, [updated], me))[0]!;
    });
  }

  // ----- helpers -------------------------------------------------------------------------------

  private decide(
    actor: RequestAuth,
    id: string,
    decision: 'approved' | 'rejected',
  ): Promise<Timesheet> {
    return this.db.tx(async (tx) => {
      const sheet = await this.findInScope(tx, actor, id);
      const me = await this.ownEmployeeId(tx, actor);
      // Nobody decides their own week, whatever their role.
      if (sheet.employeeId === me) throw forbidden('Nobody decides their own timesheet');
      await lockEmployee(tx, this.context, sheet.employeeId);
      const fresh = await tx.timesheet.findUnique({ where: { id }, select: { status: true } });
      if (fresh?.status !== 'submitted')
        throw conflict('status', 'This timesheet is not waiting for a decision');
      const updated = await tx.timesheet.update({
        where: { id },
        data: { status: decision, decidedByEmployeeId: me, decidedAt: new Date() },
        select: SELECT,
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: `timesheet.${decision}`,
        entity: 'timesheet',
        entityId: id,
        after: { weekStart: dateOut(sheet.weekStart), employeeId: sheet.employeeId },
      });
      if (sheet.employee.userId) {
        await this.outbox.publish(tx, 'timesheet.decided', {
          recipientUserId: sheet.employee.userId,
          weekStart: dateOut(sheet.weekStart),
          decision,
        });
      }
      return (await this.present(tx, actor, [updated], me))[0]!;
    });
  }

  /** A sheet of somebody inside the caller's approval scope; anything else is "not found". */
  private async findInScope(tx: TenantTx, actor: RequestAuth, id: string): Promise<Row> {
    const sheet = await tx.timesheet.findUnique({ where: { id }, select: SELECT });
    if (!sheet) throw notFound('Timesheet');
    const allowed = await this.authz.allowedEmployees(actor, 'timesheet.approve', [
      sheet.employeeId,
    ]);
    if (!allowed.has(sheet.employeeId)) throw notFound('Timesheet');
    return sheet;
  }

  private async ownEmployeeId(tx: TenantTx, actor: RequestAuth): Promise<string> {
    const employee = await tx.employee.findFirst({
      where: { userId: actor.userId, status: 'active' },
      select: { id: true },
    });
    if (!employee) throw forbidden('Only employees have timesheets');
    return employee.id;
  }

  private async present(
    tx: TenantTx,
    actor: RequestAuth,
    rows: readonly Row[],
    me: string | null,
  ): Promise<Timesheet[]> {
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.map((r) => r.employeeId))];
    const [approvable, reopenable] = await Promise.all([
      this.authz.allowedEmployees(actor, 'timesheet.approve', ids),
      this.authz.allowedEmployees(actor, 'timesheet.reopen', ids),
    ]);
    const starts = rows.map((r) => dateOut(r.weekStart)).sort();
    const entries = await tx.timeEntry.findMany({
      where: {
        employeeId: { in: ids },
        minutes: { not: null },
        workDate: { gte: dateIn(starts[0]!), lte: dateIn(addDays(starts.at(-1)!, 6)) },
      },
      select: { employeeId: true, workDate: true, minutes: true },
    });
    return rows.map((row) => {
      const start = dateOut(row.weekStart);
      const end = addDays(start, 6);
      const totalMinutes = entries
        .filter((e) => e.employeeId === row.employeeId)
        .filter((e) => {
          const date = dateOut(e.workDate);
          return date >= start && date <= end;
        })
        .reduce((sum, e) => sum + (e.minutes ?? 0), 0);
      const own = row.employeeId === me;
      return {
        id: row.id,
        employee: {
          id: row.employee.id,
          firstName: row.employee.firstName,
          lastName: row.employee.lastName,
        },
        weekStart: start,
        status: row.status as TimesheetStatus,
        totalMinutes,
        submittedAt: row.submittedAt.toISOString(),
        decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
        canDecide: !own && row.status === 'submitted' && approvable.has(row.employeeId),
        canReopen: !own && row.status === 'approved' && reopenable.has(row.employeeId),
      };
    });
  }
}
