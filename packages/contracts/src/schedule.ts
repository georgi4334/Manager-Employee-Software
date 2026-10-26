import { z } from 'zod';
import { weekday, type DateString } from './dates.js';
import { dateOnlySchema } from './employees.js';

/** Monday first, like the weeks of the time tracker. */
export const SCHEDULE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type ScheduleDay = (typeof SCHEDULE_DAYS)[number];
export const MAX_SCHEDULE_DAY_MINUTES = 16 * 60;
/** Without a schedule row a person works 8 hours Monday to Friday (ADR 0026). */
export const DEFAULT_WEEK: readonly number[] = [480, 480, 480, 480, 480, 0, 0];
export const MAX_SCHEDULE_ROWS = 50;

export interface WorkSchedule {
  validFrom: DateString;
  /** Seven values, Monday first. */
  minutes: readonly number[];
}

/** 0 = Monday … 6 = Sunday. */
export const scheduleIndex = (date: DateString): number => (weekday(date) + 6) % 7;

/** The schedule in force on a date: the latest `validFrom` on or before it, or none. */
export function scheduleFor<T extends WorkSchedule>(
  schedules: readonly T[],
  date: DateString,
): T | null {
  let found: T | null = null;
  for (const s of schedules) {
    if (s.validFrom <= date && (found === null || s.validFrom > found.validFrom)) found = s;
  }
  return found;
}

/** The contractual minutes of one date; the default week while nothing is set. */
export function scheduledMinutes(schedules: readonly WorkSchedule[], date: DateString): number {
  const week = scheduleFor(schedules, date)?.minutes ?? DEFAULT_WEEK;
  return week[scheduleIndex(date)] ?? 0;
}

export const weekMinutes = (minutes: readonly number[]): number =>
  minutes.reduce((sum, m) => sum + m, 0);

const dayMinutes = z.number().int().min(0).max(MAX_SCHEDULE_DAY_MINUTES);

export const workScheduleRequestSchema = z
  .object({
    validFrom: dateOnlySchema,
    minutes: z.array(dayMinutes).length(7),
  })
  .strict();
export type WorkScheduleRequest = z.infer<typeof workScheduleRequestSchema>;

export const workScheduleSchema = z.object({
  id: z.uuid(),
  validFrom: z.string(),
  minutes: z.array(dayMinutes).length(7),
  /** In force today. */
  current: z.boolean(),
});
export type WorkScheduleRow = z.infer<typeof workScheduleSchema>;

export const workSchedulesSchema = z.object({
  employeeId: z.uuid(),
  /** The week in force today (the default week while nothing is set). */
  effective: z.array(dayMinutes).length(7),
  isDefault: z.boolean(),
  items: z.array(workScheduleSchema),
  canManage: z.boolean(),
});
export type WorkSchedules = z.infer<typeof workSchedulesSchema>;
