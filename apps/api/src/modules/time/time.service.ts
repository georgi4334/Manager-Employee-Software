import { Injectable } from '@nestjs/common';
import {
  MAX_DAY_MINUTES,
  addDays,
  isLockedStatus,
  timerMinutes,
  weekDays,
  weekStartOf,
  type CreateTimeEntryRequest,
  type StartTimerRequest,
  type TimeEntry,
  type TimerResponse,
  type TimesheetStatus,
  type TimeWeek,
  type UpdateTimeEntryRequest,
  type WeekQuery,
} from '@intime/contracts';

import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { workspaceToday } from '../projects/projects.present.js';
import {
  conflict,
  dateIn,
  dateOut,
  forbidden,
  guardUnique,
  invalid,
  notFound,
} from '../projects/projects.shared.js';
import {
  ENTRY_SELECT,
  assertUnlocked,
  lockEmployee,
  presentEntry,
  type EntryRow,
} from './time.shared.js';

/** Timer and manual time entries (docs/adr/0015-time-tracker.md). Self-reported; nothing but the entry is stored. */
@Injectable()
export class TimeService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
  ) {}

  timer(actor: RequestAuth): Promise<TimerResponse> {
    return this.db.tx(async (tx) => {
      const me = await this.ownEmployee(tx, actor);
      const row = await this.running(tx, me.id);
      return { timer: row ? presentEntry(row, false) : null };
    });
  }

  startTimer(actor: RequestAuth, body: StartTimerRequest): Promise<TimeEntry> {
    return this.db.tx(async (tx) => {
      const me = await this.ownEmployee(tx, actor);
      await lockEmployee(tx, this.context, me.id);
      if (await this.running(tx, me.id)) throw conflict('running', 'A timer is already running');
      const project = await this.checkTarget(tx, me.id, body.projectId, body.taskId);
      const today = await workspaceToday(tx, this.context);
      await assertUnlocked(tx, me.id, today);
      const created = await guardUnique(
        () =>
          tx.timeEntry.create({
            data: {
              employeeId: me.id,
              projectId: body.projectId,
              taskId: body.taskId ?? null,
              workDate: dateIn(today),
              minutes: null,
              isBillable: project.isBillable && (body.isBillable ?? true),
              note: body.note ?? null,
              source: 'timer',
              startedAt: new Date(),
            },
            select: ENTRY_SELECT,
          }),
        'running',
      );
      return presentEntry(created, false);
    });
  }

  stopTimer(actor: RequestAuth): Promise<TimeEntry> {
    return this.db.tx(async (tx) => {
      const me = await this.ownEmployee(tx, actor);
      await lockEmployee(tx, this.context, me.id);
      const row = await this.running(tx, me.id);
      if (!row) throw notFound('Timer');
      // The week cannot be locked while a timer runs in it, so the finished entry is the owner's to correct.
      return presentEntry(await this.stop(tx, row, new Date()), true);
    });
  }

  /** Called when an employee is deactivated, in the same transaction: a running timer stops. */
  async onEmployeeDeactivated(tx: TenantTx, employeeId: string): Promise<void> {
    await lockEmployee(tx, this.context, employeeId);
    const row = await this.running(tx, employeeId);
    if (row) await this.stop(tx, row, new Date());
  }

  week(actor: RequestAuth, query: WeekQuery): Promise<TimeWeek> {
    return this.db.tx(async (tx) => {
      if (!actor.permissions['time.log'] && !actor.permissions['time.view']) {
        throw forbidden('Not allowed: time.log or time.view');
      }
      const today = await workspaceToday(tx, this.context);
      const weekStart = weekStartOf(query.weekStart ?? today);
      const me = await tx.employee.findFirst({
        where: { userId: actor.userId, status: 'active' },
        select: { id: true },
      });
      const targetId = query.employeeId ?? me?.id;
      if (!targetId) throw notFound('Employee');
      if (targetId !== me?.id) {
        const allowed = await this.authz.allowedEmployees(actor, 'time.view', [targetId]);
        if (!allowed.has(targetId)) throw notFound('Employee');
      }
      return this.weekOf(tx, actor, targetId, weekStart, targetId === me?.id, today);
    });
  }

  /** The entries, totals and sheet status of one person's week. Callers have checked the caller may see it. */
  async weekOf(
    tx: TenantTx,
    actor: RequestAuth,
    employeeId: string,
    weekStart: string,
    isOwn: boolean,
    today: string,
  ): Promise<TimeWeek> {
    const employee = await tx.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!employee) throw notFound('Employee');
    const rows = await tx.timeEntry.findMany({
      where: {
        employeeId,
        workDate: { gte: dateIn(weekStart), lte: dateIn(addDays(weekStart, 6)) },
      },
      select: ENTRY_SELECT,
      orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
    });
    const sheet = await tx.timesheet.findFirst({
      where: { employeeId, weekStart: dateIn(weekStart) },
      select: { id: true, status: true },
    });
    const status = (sheet?.status as TimesheetStatus | undefined) ?? null;
    const locked = isLockedStatus(status);
    const mayLog = isOwn && Boolean(actor.permissions['time.log']);
    const entries = rows.map((row) =>
      presentEntry(row, mayLog && !locked && !(row.source === 'timer' && row.endedAt === null)),
    );
    const finished = rows.filter((r) => r.minutes !== null);
    return {
      weekStart,
      employee,
      status,
      timesheetId: sheet?.id ?? null,
      entries,
      days: weekDays(weekStart).map((date) => ({
        date,
        minutes: finished
          .filter((r) => dateOut(r.workDate) === date)
          .reduce((sum, r) => sum + (r.minutes ?? 0), 0),
      })),
      totalMinutes: finished.reduce((sum, r) => sum + (r.minutes ?? 0), 0),
      billableMinutes: finished
        .filter((r) => r.isBillable)
        .reduce((sum, r) => sum + (r.minutes ?? 0), 0),
      canSubmit:
        isOwn &&
        Boolean(actor.permissions['timesheet.submit']) &&
        !locked &&
        weekStart <= weekStartOf(today),
    };
  }

  createEntry(actor: RequestAuth, body: CreateTimeEntryRequest): Promise<TimeEntry> {
    return this.db.tx(async (tx) => {
      const me = await this.ownEmployee(tx, actor);
      await lockEmployee(tx, this.context, me.id);
      const project = await this.checkTarget(tx, me.id, body.projectId, body.taskId);
      const today = await workspaceToday(tx, this.context);
      if (body.workDate > today) {
        throw invalid('workDate', 'future_date', 'Time cannot be logged for a day in the future');
      }
      await assertUnlocked(tx, me.id, body.workDate);
      await this.assertDayFits(tx, me.id, body.workDate, body.minutes);
      const created = await tx.timeEntry.create({
        data: {
          employeeId: me.id,
          projectId: body.projectId,
          taskId: body.taskId ?? null,
          workDate: dateIn(body.workDate),
          minutes: body.minutes,
          isBillable: project.isBillable && (body.isBillable ?? true),
          note: body.note ?? null,
          source: 'manual',
        },
        select: ENTRY_SELECT,
      });
      return presentEntry(created, true);
    });
  }

  updateEntry(actor: RequestAuth, id: string, body: UpdateTimeEntryRequest): Promise<TimeEntry> {
    return this.db.tx(async (tx) => {
      const me = await this.ownEmployee(tx, actor);
      await lockEmployee(tx, this.context, me.id);
      const row = await this.ownEntry(tx, me.id, id);
      if (row.source === 'timer' && row.endedAt === null) {
        throw conflict('running', 'A running timer is stopped, not edited');
      }
      const oldDate = dateOut(row.workDate);
      await assertUnlocked(tx, me.id, oldDate);

      const projectId = body.projectId ?? row.projectId;
      const projectChanged = body.projectId !== undefined && body.projectId !== row.projectId;
      // Another project means another task list: the old task goes unless a new one is named.
      const taskId = body.taskId !== undefined ? body.taskId : projectChanged ? null : row.taskId;
      const project =
        body.projectId !== undefined || body.taskId !== undefined
          ? await this.checkTarget(tx, me.id, projectId, taskId ?? undefined)
          : await this.projectOf(tx, projectId);
      const workDate = body.workDate ?? oldDate;
      if (body.workDate !== undefined) {
        const today = await workspaceToday(tx, this.context);
        if (workDate > today) {
          throw invalid('workDate', 'future_date', 'Time cannot be logged for a day in the future');
        }
        await assertUnlocked(tx, me.id, workDate);
      }
      const minutes = body.minutes ?? row.minutes;
      if (minutes === null) throw conflict('running', 'A running timer is stopped, not edited');
      if (body.workDate !== undefined || body.minutes !== undefined) {
        await this.assertDayFits(tx, me.id, workDate, minutes, id);
      }
      const updated = await tx.timeEntry.update({
        where: { id },
        data: {
          projectId,
          taskId,
          workDate: dateIn(workDate),
          minutes,
          isBillable: project.isBillable && (body.isBillable ?? row.isBillable),
          ...(body.note !== undefined ? { note: body.note } : {}),
        },
        select: ENTRY_SELECT,
      });
      return presentEntry(updated, true);
    });
  }

  deleteEntry(actor: RequestAuth, id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const me = await this.ownEmployee(tx, actor);
      await lockEmployee(tx, this.context, me.id);
      const row = await this.ownEntry(tx, me.id, id);
      if (row.source === 'timer' && row.endedAt === null) {
        throw conflict('running', 'A running timer is stopped, not deleted');
      }
      await assertUnlocked(tx, me.id, dateOut(row.workDate));
      await tx.timeEntry.delete({ where: { id } });
    });
  }

  // ----- helpers -------------------------------------------------------------------------------

  /** The signed-in person's active employee record: time is logged by people, not by bare accounts. */
  private async ownEmployee(tx: TenantTx, actor: RequestAuth): Promise<{ id: string }> {
    const employee = await tx.employee.findFirst({
      where: { userId: actor.userId, status: 'active' },
      select: { id: true },
    });
    if (!employee) throw forbidden('Only employees can log time');
    return employee;
  }

  private running(tx: TenantTx, employeeId: string): Promise<EntryRow | null> {
    return tx.timeEntry.findFirst({
      where: { employeeId, source: 'timer', endedAt: null },
      select: ENTRY_SELECT,
    });
  }

  private async stop(tx: TenantTx, row: EntryRow, now: Date): Promise<EntryRow> {
    const startedAt = row.startedAt!;
    const { minutes } = timerMinutes(startedAt, now);
    return tx.timeEntry.update({
      where: { id: row.id },
      data: {
        minutes,
        // A capped timer ends where its minutes end, so the record stays consistent.
        endedAt: new Date(
          Math.max(
            startedAt.getTime(),
            Math.min(now.getTime(), startedAt.getTime() + minutes * 60_000),
          ),
        ),
      },
      select: ENTRY_SELECT,
    });
  }

  /** Own entries only: anybody else's is "not found". */
  private async ownEntry(tx: TenantTx, employeeId: string, id: string): Promise<EntryRow> {
    const row = await tx.timeEntry.findFirst({ where: { id, employeeId }, select: ENTRY_SELECT });
    if (!row) throw notFound('Time entry');
    return row;
  }

  private async projectOf(tx: TenantTx, projectId: string) {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, status: true, isBillable: true, leadEmployeeId: true },
    });
    if (!project) throw invalid('projectId', 'unknown_project', 'This project does not exist');
    return project;
  }

  /** The project is open, the person works on it (staffed or lead) and the task belongs to it. */
  private async checkTarget(
    tx: TenantTx,
    employeeId: string,
    projectId: string,
    taskId: string | undefined,
  ) {
    const project = await this.projectOf(tx, projectId);
    if (project.status === 'done') {
      throw invalid('projectId', 'project_closed', 'This project is finished');
    }
    if (project.leadEmployeeId !== employeeId) {
      const staffed = await tx.projectAssignment.findFirst({
        where: { projectId, employeeId },
        select: { id: true },
      });
      if (!staffed) throw invalid('projectId', 'not_on_project', 'You are not on this project');
    }
    if (taskId) {
      const task = await tx.task.findFirst({
        where: { id: taskId, projectId },
        select: { id: true },
      });
      if (!task)
        throw invalid('taskId', 'task_not_in_project', 'This task is not part of the project');
    }
    return project;
  }

  /** All finished entries of one person and day stay within 24 hours. */
  private async assertDayFits(
    tx: TenantTx,
    employeeId: string,
    date: string,
    minutes: number,
    exceptId?: string,
  ): Promise<void> {
    const sum = await tx.timeEntry.aggregate({
      where: {
        employeeId,
        workDate: dateIn(date),
        minutes: { not: null },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      _sum: { minutes: true },
    });
    if ((sum._sum.minutes ?? 0) + minutes > MAX_DAY_MINUTES) {
      throw invalid('minutes', 'day_too_long', 'A day cannot hold more than 24 hours');
    }
  }
}
