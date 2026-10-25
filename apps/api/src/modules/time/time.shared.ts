import {
  isLockedStatus,
  taskKey,
  weekStartOf,
  type TimeEntry,
  type TimesheetStatus,
} from '@intime/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TenantContext, TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { conflict, dateIn, dateOut } from '../projects/projects.shared.js';

export const ENTRY_SELECT = {
  id: true,
  employeeId: true,
  projectId: true,
  taskId: true,
  workDate: true,
  minutes: true,
  isBillable: true,
  note: true,
  source: true,
  startedAt: true,
  endedAt: true,
  employee: { select: { id: true, firstName: true, lastName: true, userId: true } },
  project: { select: { id: true, code: true, name: true } },
  task: { select: { id: true, number: true } },
} satisfies Prisma.TimeEntrySelect;
export type EntryRow = Prisma.TimeEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

/** An entry as the API shows it; `canEdit` is decided by the caller of this function. */
export const presentEntry = (row: EntryRow, canEdit: boolean): TimeEntry => ({
  id: row.id,
  employee: {
    id: row.employee.id,
    firstName: row.employee.firstName,
    lastName: row.employee.lastName,
  },
  project: row.project,
  task: row.task ? { id: row.task.id, key: taskKey(row.project.code, row.task.number) } : null,
  workDate: dateOut(row.workDate),
  minutes: row.minutes,
  isBillable: row.isBillable,
  note: row.note,
  source: row.source as TimeEntry['source'],
  startedAt: row.startedAt ? row.startedAt.toISOString() : null,
  running: row.source === 'timer' && row.endedAt === null,
  canEdit,
});

/** Per-employee lock: entries, the timer and the timesheet of one person change one at a time. */
export async function lockEmployee(
  tx: TenantTx,
  context: TenantContext,
  employeeId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`time-employee:${context.requireTenantId()}:${employeeId}`}))`;
}

export async function sheetStatus(
  tx: TenantTx,
  employeeId: string,
  weekStart: string,
): Promise<TimesheetStatus | null> {
  const sheet = await tx.timesheet.findFirst({
    where: { employeeId, weekStart: dateIn(weekStart) },
    select: { status: true },
  });
  return (sheet?.status as TimesheetStatus | undefined) ?? null;
}

/** A submitted or approved week cannot change (reject or reopen it first). */
export async function assertUnlocked(
  tx: TenantTx,
  employeeId: string,
  date: string,
): Promise<void> {
  if (isLockedStatus(await sheetStatus(tx, employeeId, weekStartOf(date)))) {
    throw conflict('locked', 'This week is submitted or approved and cannot be changed');
  }
}
