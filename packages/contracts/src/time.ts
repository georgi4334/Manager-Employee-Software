import { z } from 'zod';
import { addDays, eachDay, weekday, type DateString } from './dates.js';
import { dateOnlySchema } from './employees.js';

export const TIME_SOURCES = ['timer', 'manual'] as const;
export type TimeSource = (typeof TIME_SOURCES)[number];
export const TIMESHEET_STATUSES = ['submitted', 'approved', 'rejected', 'open'] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

export const MAX_TIME_ENTRY_MINUTES = 16 * 60;
export const MAX_DAY_MINUTES = 24 * 60;
export const MAX_TIME_NOTE = 500;

// ----- pure rules ------------------------------------------------------------------------------

/** The Monday of the week a date is in (weeks run Monday to Sunday). */
export function weekStartOf(date: DateString): DateString {
  const sinceMonday = (weekday(date) + 6) % 7;
  return addDays(date, -sinceMonday);
}
export const isWeekStart = (date: DateString): boolean => weekday(date) === 1;
/** The seven dates of the week that starts on `start`. */
export const weekDays = (start: DateString): DateString[] => eachDay(start, addDays(start, 6));

/** A submitted or approved sheet locks the entries of its week. No sheet, open and rejected stay editable. */
export const isLockedStatus = (status: TimesheetStatus | null | undefined): boolean =>
  status === 'submitted' || status === 'approved';

/**
 * What a running timer is worth when it stops: elapsed time rounded up to whole minutes, at least 1, at most 16 h.
 * `capped` is true when the timer was left running longer than the maximum.
 */
export function timerMinutes(startedAt: Date, now: Date): { minutes: number; capped: boolean } {
  const elapsed = Math.ceil((now.getTime() - startedAt.getTime()) / 60_000);
  const minutes = Math.min(Math.max(elapsed, 1), MAX_TIME_ENTRY_MINUTES);
  return { minutes, capped: elapsed > MAX_TIME_ENTRY_MINUTES };
}

/**
 * Reads what people type for a duration: "1:30" (hours:minutes) or decimal hours "1.5" / "1,5".
 * Returns whole minutes, or null when it is not a duration or outside 1 minute … 16 hours.
 */
export function parseDuration(text: string): number | null {
  const value = text.trim();
  let minutes: number;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(value);
  if (clock) {
    minutes = Number(clock[1]) * 60 + Number(clock[2]);
  } else if (/^\d{1,2}([.,]\d{1,2})?$/.test(value)) {
    minutes = Math.round(Number(value.replace(',', '.')) * 60);
  } else {
    return null;
  }
  return minutes >= 1 && minutes <= MAX_TIME_ENTRY_MINUTES ? minutes : null;
}

/** "H:MM", e.g. 90 → "1:30". */
export function formatDuration(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// ----- requests --------------------------------------------------------------------------------

const note = z
  .string()
  .trim()
  .max(MAX_TIME_NOTE, { error: 'tooLong' })
  .transform((value) => (value === '' ? undefined : value));
const clearableNote = z
  .string()
  .trim()
  .max(MAX_TIME_NOTE, { error: 'tooLong' })
  .transform((value) => (value === '' ? null : value))
  .nullable();
const minutes = z.number().int().min(1).max(MAX_TIME_ENTRY_MINUTES);

export const startTimerRequestSchema = z
  .object({
    projectId: z.uuid(),
    taskId: z.uuid().optional(),
    note: note.optional(),
    isBillable: z.boolean().optional(),
  })
  .strict();
export type StartTimerRequest = z.infer<typeof startTimerRequestSchema>;

export const createTimeEntryRequestSchema = z
  .object({
    projectId: z.uuid(),
    taskId: z.uuid().optional(),
    workDate: dateOnlySchema,
    minutes,
    isBillable: z.boolean().optional(),
    note: note.optional(),
  })
  .strict();
export type CreateTimeEntryRequest = z.infer<typeof createTimeEntryRequestSchema>;

export const updateTimeEntryRequestSchema = z
  .object({
    projectId: z.uuid(),
    taskId: z.uuid().nullable(),
    workDate: dateOnlySchema,
    minutes,
    isBillable: z.boolean(),
    note: clearableNote,
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'required' });
export type UpdateTimeEntryRequest = z.infer<typeof updateTimeEntryRequestSchema>;

export const weekQuerySchema = z.object({
  /** Any date; the week it is in is used. Default: this week. */
  weekStart: dateOnlySchema.optional(),
  /** Omitted = yourself. */
  employeeId: z.uuid().optional(),
});
export type WeekQuery = z.infer<typeof weekQuerySchema>;

export const submitTimesheetRequestSchema = z.object({ weekStart: dateOnlySchema }).strict();
export type SubmitTimesheetRequest = z.infer<typeof submitTimesheetRequestSchema>;

export const timesheetQuerySchema = z.object({
  status: z.enum([...TIMESHEET_STATUSES, 'all']).default('submitted'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type TimesheetQuery = z.infer<typeof timesheetQuerySchema>;

// ----- responses -------------------------------------------------------------------------------

const person = z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() });

export const timeEntrySchema = z.object({
  id: z.uuid(),
  employee: person,
  project: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
  task: z.object({ id: z.uuid(), key: z.string() }).nullable(),
  workDate: z.string(),
  /** null while the timer runs. */
  minutes: z.number().int().nullable(),
  isBillable: z.boolean(),
  note: z.string().nullable(),
  source: z.enum(TIME_SOURCES),
  startedAt: z.string().nullable(),
  running: z.boolean(),
  /** The caller may change or delete it (own entry, week not locked, not running). */
  canEdit: z.boolean(),
});
export type TimeEntry = z.infer<typeof timeEntrySchema>;

export const timerResponseSchema = z.object({ timer: timeEntrySchema.nullable() });
export type TimerResponse = z.infer<typeof timerResponseSchema>;

export const timeWeekSchema = z.object({
  weekStart: z.string(),
  employee: person,
  /** null = never submitted. */
  status: z.enum(TIMESHEET_STATUSES).nullable(),
  timesheetId: z.uuid().nullable(),
  entries: z.array(timeEntrySchema),
  days: z.array(z.object({ date: z.string(), minutes: z.number().int() })),
  totalMinutes: z.number().int(),
  billableMinutes: z.number().int(),
  /** Own week, not locked, not in the future. */
  canSubmit: z.boolean(),
});
export type TimeWeek = z.infer<typeof timeWeekSchema>;

export const timesheetSchema = z.object({
  id: z.uuid(),
  employee: person,
  weekStart: z.string(),
  status: z.enum(TIMESHEET_STATUSES),
  totalMinutes: z.number().int(),
  submittedAt: z.string(),
  decidedAt: z.string().nullable(),
  /** The caller may approve or reject it. */
  canDecide: z.boolean(),
  /** The caller may reopen it (approved, not their own). */
  canReopen: z.boolean(),
});
export type Timesheet = z.infer<typeof timesheetSchema>;

export const timesheetListSchema = z.object({
  items: z.array(timesheetSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type TimesheetList = z.infer<typeof timesheetListSchema>;
