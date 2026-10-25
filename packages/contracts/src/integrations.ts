import { z } from 'zod';
import { dateOnlySchema } from './employees.js';

// ----- leave conflicts (ADR 0017 §1) ---------------------------------------------------------------

export const leaveConflictsSchema = z.object({
  /** Projects the person is staffed on while they are away. */
  assignments: z.array(
    z.object({
      projectId: z.uuid(),
      code: z.string(),
      name: z.string(),
      allocationPct: z.number().int(),
      fromDate: z.string(),
      toDate: z.string().nullable(),
    }),
  ),
  /** Open milestones of those projects that fall due while they are away. */
  milestones: z.array(
    z.object({
      id: z.uuid(),
      projectId: z.uuid(),
      code: z.string(),
      title: z.string(),
      dueDate: z.string(),
    }),
  ),
  /** Open tasks of the person due while they are away: the reference and date, never the title. */
  tasks: z.array(
    z.object({ id: z.uuid(), projectId: z.uuid(), key: z.string(), dueDate: z.string() }),
  ),
});
export type LeaveConflicts = z.infer<typeof leaveConflictsSchema>;

// ----- attendance versus logged time (ADR 0017 §2) --------------------------------------------------

export const COMPARE_TOLERANCE_MINUTES = 30;
export const COMPARE_FLAGS = ['none', 'more_logged', 'less_logged'] as const;
export type CompareFlag = (typeof COMPARE_FLAGS)[number];

/**
 * Do presence and logged time of one day tell a different story? Approved leave, a record that is still open
 * (its length is unknown) and days with nothing on either side are never flagged. The difference must exceed
 * the tolerance.
 */
export function compareDay(day: {
  attendanceMinutes: number;
  loggedMinutes: number;
  onLeave: boolean;
  openRecord: boolean;
}): CompareFlag {
  if (day.onLeave || day.openRecord) return 'none';
  if (day.attendanceMinutes === 0 && day.loggedMinutes === 0) return 'none';
  if (day.loggedMinutes - day.attendanceMinutes > COMPARE_TOLERANCE_MINUTES) return 'more_logged';
  if (day.attendanceMinutes - day.loggedMinutes > COMPARE_TOLERANCE_MINUTES) return 'less_logged';
  return 'none';
}

export const compareQuerySchema = z.object({
  /** Any date; the week it is in is used. Default: this week. */
  weekStart: dateOnlySchema.optional(),
  /** Omitted = yourself. */
  employeeId: z.uuid().optional(),
});
export type CompareQuery = z.infer<typeof compareQuerySchema>;

export const compareSchema = z.object({
  weekStart: z.string(),
  days: z.array(
    z.object({
      date: z.string(),
      attendanceMinutes: z.number().int(),
      loggedMinutes: z.number().int(),
      onLeave: z.boolean(),
      openRecord: z.boolean(),
      flag: z.enum(COMPARE_FLAGS),
    }),
  ),
});
export type Compare = z.infer<typeof compareSchema>;

// ----- reminders (ADR 0017 §3) ----------------------------------------------------------------------

/** An attendance record still open this long after check-in is reported once. */
export const OPEN_ATTENDANCE_REMINDER_HOURS = 12;
/** A timer still running this long after it started is reported once. */
export const RUNNING_TIMER_REMINDER_HOURS = 10;

/** Is something that started at `since` overdue for a reminder after `hours`? */
export const reminderDue = (since: Date, now: Date, hours: number): boolean =>
  now.getTime() - since.getTime() >= hours * 3_600_000;
