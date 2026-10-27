import { z } from 'zod';
import { daysBetween, type DateString } from './dates.js';
import { dateOnlySchema } from './employees.js';

export const FIND_TIME_MAX_PEOPLE = 20;
export const FIND_TIME_MAX_DAYS = 14;
export const FIND_TIME_MIN_MINUTES = 15;
export const FIND_TIME_MAX_MINUTES = 480;
export const FIND_TIME_MAX_SLOTS = 10;
/** The common working window of find-a-time, in workspace time (a product default, ADR 0028). */
export const FIND_TIME_WINDOW = { start: 9 * 60, end: 18 * 60 } as const;
export const FIND_TIME_STEP = 30;

export interface Interval {
  /** Minutes since midnight, end exclusive. */
  start: number;
  end: number;
}

export interface DayAvailability {
  date: DateString;
  people: readonly { available: boolean; busy: readonly Interval[] }[];
}

export interface Slot {
  date: DateString;
  start: number;
  end: number;
}

/** Does [start, end) overlap any busy interval? */
export const overlapsAny = (busy: readonly Interval[], start: number, end: number): boolean =>
  busy.some((b) => b.start < end && start < b.end);

/**
 * The earliest slots of `duration` minutes inside the window, on the step grid, where nobody is busy and everybody is
 * available that day. Days are scanned in the given order; at most `limit` slots come back.
 */
export function findSlots(
  days: readonly DayAvailability[],
  duration: number,
  options: { window?: Interval; step?: number; limit?: number } = {},
): Slot[] {
  const window = options.window ?? FIND_TIME_WINDOW;
  const step = options.step ?? FIND_TIME_STEP;
  const limit = options.limit ?? FIND_TIME_MAX_SLOTS;
  const slots: Slot[] = [];
  if (duration <= 0 || step <= 0) return slots;
  for (const day of days) {
    if (day.people.length === 0 || day.people.some((p) => !p.available)) continue;
    for (let start = window.start; start + duration <= window.end; start += step) {
      const end = start + duration;
      if (day.people.some((p) => overlapsAny(p.busy, start, end))) continue;
      slots.push({ date: day.date, start, end });
      if (slots.length >= limit) return slots;
    }
  }
  return slots;
}

/** "HH:MM" of minutes since midnight. */
export const minutesToTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export const findTimeRequestSchema = z
  .object({
    employeeIds: z
      .array(z.uuid())
      .min(1)
      .max(FIND_TIME_MAX_PEOPLE)
      .refine((ids) => new Set(ids).size === ids.length, { error: 'duplicate' }),
    from: dateOnlySchema,
    to: dateOnlySchema,
    durationMinutes: z.number().int().min(FIND_TIME_MIN_MINUTES).max(FIND_TIME_MAX_MINUTES),
  })
  .strict()
  .refine((v) => v.to >= v.from, { path: ['to'], error: 'end_before_start' })
  .refine((v) => v.to < v.from || daysBetween(v.from, v.to) + 1 <= FIND_TIME_MAX_DAYS, {
    path: ['to'],
    error: 'too_long',
  });
export type FindTimeRequest = z.infer<typeof findTimeRequestSchema>;

export const timeSlotSchema = z.object({
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
});
export type TimeSlot = z.infer<typeof timeSlotSchema>;
export const findTimeResponseSchema = z.object({ slots: z.array(timeSlotSchema) });
export type FindTimeResponse = z.infer<typeof findTimeResponseSchema>;
