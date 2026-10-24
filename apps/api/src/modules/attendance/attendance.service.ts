import { Injectable } from '@nestjs/common';
import {
  ATTENDANCE_SELF_EDIT_DAYS,
  MAX_ATTENDANCE_MINUTES,
  MAX_ATTENDANCE_RANGE_DAYS,
  addDays,
  daysBetween,
  minutesBetween,
  todayIn,
  utcToZoned,
  zonedToUtc,
  type AttendanceRecord,
  type AttendanceRecordList,
  type AttendanceStatus,
  type CheckInRequest,
  type CheckOutRequest,
  type CreateRecordRequest,
  type Presence,
  type PresenceItem,
  type RecordQuery,
  type UpdateRecordRequest,
} from '@intime/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../notifications/outbox.service.js';

const dateOut = (date: Date): string => date.toISOString().slice(0, 10);
const dateIn = (value: string): Date => new Date(`${value}T00:00:00Z`);
const notFound = (what: string) => new AppException('NOT_FOUND', { message: `${what} not found` });
const conflict = (field: string, message: string) =>
  new AppException('CONFLICT', { message, params: { field } });
const invalid = (path: string, code: string, message: string) =>
  new AppException('VALIDATION_FAILED', { details: [{ path, code, message }] });
const forbidden = (message: string) => new AppException('FORBIDDEN', { message });

const SELECT = {
  id: true,
  employeeId: true,
  workDate: true,
  checkInAt: true,
  checkOutAt: true,
  mode: true,
  note: true,
  source: true,
  employee: { select: { id: true, firstName: true, lastName: true, userId: true, status: true } },
} satisfies Prisma.AttendanceRecordSelect;

type Row = Prisma.AttendanceRecordGetPayload<{ select: typeof SELECT }>;

/** Manual working-time records (docs/adr/0009-attendance.md). */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ----- the own clock -------------------------------------------------------------------------

  status(actor: RequestAuth): Promise<AttendanceStatus> {
    return this.db.tx(async (tx) => {
      const { employee, zone, today } = await this.own(tx, actor);
      const rows = await tx.attendanceRecord.findMany({
        where: { employeeId: employee.id, OR: [{ workDate: dateIn(today) }, { checkOutAt: null }] },
        select: SELECT,
        orderBy: { checkInAt: 'asc' },
      });
      const records = await this.present(tx, actor, rows, zone, today);
      const open = records.find((r) => r.open) ?? null;
      const minutes = records
        .filter((r) => r.date === today)
        .reduce((total, r) => total + (r.minutes ?? 0), 0);
      return { today, open, records, minutes };
    });
  }

  checkIn(actor: RequestAuth, body: CheckInRequest): Promise<AttendanceRecord> {
    return this.db.tx(async (tx) => {
      const { employee, zone } = await this.own(tx, actor);
      const now = new Date();
      if (
        await tx.attendanceRecord.findFirst({
          where: { employeeId: employee.id, checkOutAt: null },
          select: { id: true },
        })
      ) {
        throw conflict('open', 'There is already an open record; check out first');
      }
      let id: string;
      try {
        id = (
          await tx.attendanceRecord.create({
            data: {
              employeeId: employee.id,
              workDate: dateIn(utcToZoned(now, zone).date),
              checkInAt: now,
              mode: body.mode,
              note: body.note ?? null,
              source: 'clock',
            },
            select: { id: true },
          })
        ).id;
      } catch (error) {
        throw this.mapDbError(error);
      }
      return this.one(tx, actor, id, zone);
    });
  }

  checkOut(actor: RequestAuth, body: CheckOutRequest): Promise<AttendanceRecord> {
    return this.db.tx(async (tx) => {
      const { employee, zone } = await this.own(tx, actor);
      const open = await tx.attendanceRecord.findFirst({
        where: { employeeId: employee.id, checkOutAt: null },
        select: { id: true, checkInAt: true },
      });
      if (!open) throw conflict('open', 'There is no open record to close');
      const now = new Date();
      const at = body.at ? new Date(body.at) : now;
      if (at > now) throw invalid('at', 'in_future', 'The check-out cannot be in the future');
      if (at <= open.checkInAt)
        throw invalid('at', 'before_check_in', 'The check-out must be after the check-in');
      if (minutesBetween(open.checkInAt, at) > MAX_ATTENDANCE_MINUTES) {
        throw invalid('at', 'too_long', 'A record can be at most 16 hours long');
      }
      const changed = await tx.attendanceRecord.updateMany({
        where: { id: open.id, checkOutAt: null },
        data: { checkOutAt: at },
      });
      if (changed.count !== 1) throw conflict('open', 'The record was closed in the meantime');
      return this.one(tx, actor, open.id, zone);
    });
  }

  // ----- typed-in records and corrections ------------------------------------------------------

  create(actor: RequestAuth, body: CreateRecordRequest): Promise<AttendanceRecord> {
    return this.db.tx(async (tx) => {
      const ctx = await this.zoneAndToday(tx);
      const own = await tx.employee.findFirst({
        where: { userId: actor.userId },
        select: { id: true },
      });
      const targetId = body.employeeId ?? own?.id;
      if (!targetId) throw notFound('Employee record');
      const target = await tx.employee.findUnique({
        where: { id: targetId },
        select: { id: true, status: true, userId: true },
      });
      if (!target) throw notFound('Employee');
      const forSelf = target.id === own?.id;

      if (forSelf) {
        await this.authz.assert(actor, 'attendance.record', { ownerEmployeeId: target.id });
        if (target.status !== 'active') throw notFound('Employee record');
        this.assertSelfWindow(body.date, ctx.today);
      } else {
        await this.authz.assert(actor, 'attendance.correct', { ownerEmployeeId: target.id });
        if (body.date > ctx.today)
          throw invalid('date', 'in_future', 'The date cannot be in the future');
      }

      const { start, end } = this.instants(body.date, body.startTime, body.endTime, ctx.zone);
      if (end > new Date())
        throw invalid('endTime', 'in_future', 'The end cannot be in the future');
      await this.assertNoOverlap(tx, target.id, start, end);
      let id: string;
      try {
        id = (
          await tx.attendanceRecord.create({
            data: {
              employeeId: target.id,
              workDate: dateIn(body.date),
              checkInAt: start,
              checkOutAt: end,
              mode: body.mode,
              note: body.note ?? null,
              source: forSelf ? 'entry' : 'correction',
            },
            select: { id: true },
          })
        ).id;
      } catch (error) {
        throw this.mapDbError(error);
      }
      if (!forSelf) await this.afterCorrection(tx, actor, target, id, body.date, 'created');
      return this.one(tx, actor, id, ctx.zone);
    });
  }

  update(actor: RequestAuth, id: string, body: UpdateRecordRequest): Promise<AttendanceRecord> {
    return this.db.tx(async (tx) => {
      const ctx = await this.zoneAndToday(tx);
      const row = await this.find(tx, id);
      const byOwner = await this.assertMayChange(tx, actor, row, ctx.today);

      const open = row.checkOutAt === null;
      const touchesTimes =
        body.date !== undefined || body.startTime !== undefined || body.endTime !== undefined;
      if (open && touchesTimes) {
        throw invalid('endTime', 'open_record', 'An open record is closed by checking out');
      }
      const data: Prisma.AttendanceRecordUpdateInput = {};
      let newDate = dateOut(row.workDate);
      if (touchesTimes) {
        const local = {
          start: utcToZoned(row.checkInAt, ctx.zone),
          end: utcToZoned(row.checkOutAt as Date, ctx.zone),
        };
        newDate = body.date ?? local.start.date;
        if (byOwner) this.assertSelfWindow(newDate, ctx.today);
        else if (newDate > ctx.today)
          throw invalid('date', 'in_future', 'The date cannot be in the future');
        const { start, end } = this.instants(
          newDate,
          body.startTime ?? local.start.time,
          body.endTime ?? local.end.time,
          ctx.zone,
        );
        if (end > new Date())
          throw invalid('endTime', 'in_future', 'The end cannot be in the future');
        await this.assertNoOverlap(tx, row.employeeId, start, end, row.id);
        data.workDate = dateIn(newDate);
        data.checkInAt = start;
        data.checkOutAt = end;
      }
      if (body.mode !== undefined) data.mode = body.mode;
      if (body.note !== undefined) data.note = body.note;
      if (!byOwner) data.source = 'correction';
      else if (touchesTimes) data.source = 'entry';

      try {
        await tx.attendanceRecord.update({ where: { id }, data });
      } catch (error) {
        throw this.mapDbError(error);
      }
      if (!byOwner) await this.afterCorrection(tx, actor, row.employee, id, newDate, 'updated');
      return this.one(tx, actor, id, ctx.zone);
    });
  }

  remove(actor: RequestAuth, id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const ctx = await this.zoneAndToday(tx);
      const row = await this.find(tx, id);
      const byOwner = await this.assertMayChange(tx, actor, row, ctx.today);
      await tx.attendanceRecord.delete({ where: { id } });
      if (!byOwner)
        await this.afterCorrection(tx, actor, row.employee, id, dateOut(row.workDate), 'deleted');
    });
  }

  // ----- reading -------------------------------------------------------------------------------

  list(actor: RequestAuth, query: RecordQuery): Promise<AttendanceRecordList> {
    return this.db.tx(async (tx) => {
      if (daysBetween(query.from, query.to) + 1 > MAX_ATTENDANCE_RANGE_DAYS) {
        throw invalid('to', 'too_long', 'The period is too long');
      }
      const ctx = await this.zoneAndToday(tx);
      const visible = await this.visibleEmployees(tx, actor);
      if (query.employeeId && visible && !visible.has(query.employeeId)) {
        return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
      }
      const where: Prisma.AttendanceRecordWhereInput = {
        workDate: { gte: dateIn(query.from), lte: dateIn(query.to) },
        ...(query.employeeId
          ? { employeeId: query.employeeId }
          : visible
            ? { employeeId: { in: [...visible] } }
            : {}),
      };
      const [rows, total] = await Promise.all([
        tx.attendanceRecord.findMany({
          where,
          select: SELECT,
          orderBy: [{ workDate: 'asc' }, { checkInAt: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.attendanceRecord.count({ where }),
      ]);
      return {
        items: await this.present(tx, actor, rows, ctx.zone, ctx.today),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  /** Who is working, done, on leave or not recorded today, among the people the caller may see. */
  presence(actor: RequestAuth): Promise<Presence> {
    return this.db.tx(async (tx) => {
      const { zone, today } = await this.zoneAndToday(tx);
      const visible = await this.visibleEmployees(tx, actor);
      const employees = await tx.employee.findMany({
        where: { status: 'active', ...(visible ? { id: { in: [...visible] } } : {}) },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        take: 1000,
      });
      const ids = employees.map((e) => e.id);
      const records = await tx.attendanceRecord.findMany({
        where: { employeeId: { in: ids }, OR: [{ workDate: dateIn(today) }, { checkOutAt: null }] },
        select: { employeeId: true, workDate: true, checkInAt: true, checkOutAt: true, mode: true },
        orderBy: { checkInAt: 'asc' },
      });
      const onLeave = new Set(
        (
          await tx.leaveRequestDay.findMany({
            where: { day: dateIn(today), request: { status: 'approved', employeeId: { in: ids } } },
            select: { request: { select: { employeeId: true } } },
          })
        ).map((d) => d.request.employeeId),
      );
      const items: PresenceItem[] = employees.map((employee) => {
        const mine = records.filter((r) => r.employeeId === employee.id);
        const open = mine.find((r) => r.checkOutAt === null);
        const todays = mine.filter((r) => dateOut(r.workDate) === today && r.checkOutAt);
        const minutes = todays.reduce(
          (t, r) => t + minutesBetween(r.checkInAt, r.checkOutAt as Date),
          0,
        );
        if (open) {
          return {
            employee,
            state: 'working',
            mode: open.mode as PresenceItem['mode'],
            since: utcToZoned(open.checkInAt, zone).time,
            minutes,
          };
        }
        if (todays.length > 0)
          return {
            employee,
            state: 'done',
            mode: todays.at(-1)!.mode as PresenceItem['mode'],
            since: null,
            minutes,
          };
        return {
          employee,
          state: onLeave.has(employee.id) ? 'leave' : 'none',
          mode: null,
          since: null,
          minutes: 0,
        };
      });
      return { date: today, items };
    });
  }

  // ----- helpers -------------------------------------------------------------------------------

  private async zoneAndToday(tx: TenantTx): Promise<{ zone: string; today: string }> {
    const tenant = await tx.tenant.findUnique({
      where: { id: this.context.requireTenantId() },
      select: { defaultTimezone: true },
    });
    const zone = tenant?.defaultTimezone ?? 'UTC';
    return { zone, today: todayIn(zone) };
  }

  private async own(tx: TenantTx, actor: RequestAuth) {
    const ctx = await this.zoneAndToday(tx);
    const employee = await tx.employee.findFirst({
      where: { userId: actor.userId },
      select: { id: true, status: true },
    });
    if (!employee || employee.status !== 'active') throw notFound('Employee record');
    return { employee, ...ctx };
  }

  private async find(tx: TenantTx, id: string): Promise<Row> {
    const row = await tx.attendanceRecord.findUnique({ where: { id }, select: SELECT });
    if (!row) throw notFound('Attendance record');
    return row;
  }

  private async one(
    tx: TenantTx,
    actor: RequestAuth,
    id: string,
    zone: string,
  ): Promise<AttendanceRecord> {
    const { today } = await this.zoneAndToday(tx);
    const [record] = await this.present(tx, actor, [await this.find(tx, id)], zone, today);
    if (!record) throw notFound('Attendance record');
    return record;
  }

  /** null = everybody (scope "all"). */
  private async visibleEmployees(tx: TenantTx, actor: RequestAuth): Promise<Set<string> | null> {
    if (actor.permissions['attendance.view'] === 'all') return null;
    const everyone = (await tx.employee.findMany({ select: { id: true } })).map((e) => e.id);
    return this.authz.allowedEmployees(actor, 'attendance.view', everyone);
  }

  /** Own recent records may be changed by their owner; everybody else's only by a corrector, never your own old ones. */
  private async assertMayChange(
    tx: TenantTx,
    actor: RequestAuth,
    row: Row,
    today: string,
  ): Promise<boolean> {
    const isOwner = row.employee.userId === actor.userId;
    if (isOwner) {
      await this.authz.assert(actor, 'attendance.record', { ownerEmployeeId: row.employeeId });
      if (daysBetween(dateOut(row.workDate), today) > ATTENDANCE_SELF_EDIT_DAYS) {
        throw forbidden('Older records can only be changed by your manager or HR');
      }
      return true;
    }
    await this.authz.assert(actor, 'attendance.correct', { ownerEmployeeId: row.employeeId });
    return false;
  }

  private assertSelfWindow(date: string, today: string): void {
    if (date > today) throw invalid('date', 'in_future', 'The date cannot be in the future');
    if (date < addDays(today, -ATTENDANCE_SELF_EDIT_DAYS)) {
      throw invalid('date', 'too_far_in_past', 'Only the last 7 days can be entered by yourself');
    }
  }

  private instants(
    date: string,
    startTime: string,
    endTime: string,
    zone: string,
  ): { start: Date; end: Date } {
    const start = zonedToUtc(date, startTime, zone);
    const end = zonedToUtc(date, endTime, zone);
    if (!start)
      throw invalid('startTime', 'nonexistent_time', 'This time does not exist on that day');
    if (!end) throw invalid('endTime', 'nonexistent_time', 'This time does not exist on that day');
    if (end <= start)
      throw invalid('endTime', 'end_before_start', 'The end must be after the start');
    if (minutesBetween(start, end) > MAX_ATTENDANCE_MINUTES) {
      throw invalid('endTime', 'too_long', 'A record can be at most 16 hours long');
    }
    return { start, end };
  }

  private async assertNoOverlap(
    tx: TenantTx,
    employeeId: string,
    start: Date,
    end: Date,
    exceptId?: string,
  ) {
    const clash = await tx.attendanceRecord.findFirst({
      where: {
        employeeId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
        checkInAt: { lt: end },
        OR: [{ checkOutAt: null }, { checkOutAt: { gt: start } }],
      },
      select: { id: true },
    });
    if (clash) throw conflict('overlap', 'The period overlaps another record');
  }

  /** The database rules (open record, overlap) as clean conflicts, even when two requests race. */
  private mapDbError(error: unknown): unknown {
    const message = String((error as Error)?.message ?? '');
    if (message.includes('attendance_record_one_open'))
      return conflict('open', 'There is already an open record');
    if (message.includes('attendance_record_no_overlap'))
      return conflict('overlap', 'The period overlaps another record');
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return conflict('open', 'There is already an open record');
    }
    return error;
  }

  /** A change made by somebody else: audited (ids only) and the person is told (date and kind only). */
  private async afterCorrection(
    tx: TenantTx,
    actor: RequestAuth,
    employee: { id: string; userId: string | null },
    recordId: string,
    date: string,
    action: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    await this.audit.record(tx, {
      actorUserId: actor.userId,
      action: `attendance.${action}`,
      entity: 'attendance_record',
      entityId: recordId,
      after: { employeeId: employee.id },
    });
    if (employee.userId) {
      await this.outbox.publish(tx, 'attendance.corrected', {
        recipientUserId: employee.userId,
        date,
        action,
      });
    }
  }

  private async present(
    tx: TenantTx,
    actor: RequestAuth,
    rows: Row[],
    zone: string,
    today: string,
  ): Promise<AttendanceRecord[]> {
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.map((r) => r.employeeId))];
    const correctable = await this.authz.allowedEmployees(actor, 'attendance.correct', ids);
    return rows.map((row) => {
      const isOwner = row.employee.userId === actor.userId;
      const local = utcToZoned(row.checkInAt, zone);
      const end = row.checkOutAt ? utcToZoned(row.checkOutAt, zone) : null;
      const canEdit = isOwner
        ? daysBetween(dateOut(row.workDate), today) <= ATTENDANCE_SELF_EDIT_DAYS
        : correctable.has(row.employeeId);
      return {
        id: row.id,
        employee: {
          id: row.employee.id,
          firstName: row.employee.firstName,
          lastName: row.employee.lastName,
        },
        date: dateOut(row.workDate),
        startTime: local.time,
        endTime: end?.time ?? null,
        checkInAt: row.checkInAt.toISOString(),
        checkOutAt: row.checkOutAt?.toISOString() ?? null,
        minutes: row.checkOutAt ? minutesBetween(row.checkInAt, row.checkOutAt) : null,
        mode: row.mode as AttendanceRecord['mode'],
        note: row.note,
        source: row.source as AttendanceRecord['source'],
        open: row.checkOutAt === null,
        canEdit,
      };
    });
  }
}
