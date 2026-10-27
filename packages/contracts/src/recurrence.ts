import { z } from 'zod';
import { addDays, daysBetween, weekday, type DateString } from './dates.js';
import { addMonths } from './retention.js';
import { dateOnlySchema } from './employees.js';

export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];
export const MAX_RECURRENCE_INTERVAL = 30;
export const MAX_RECURRENCE_COUNT = 500;
/** A safety net for one series and one window. */
export const MAX_OCCURRENCES = 366;

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval: number;
  /** Weekly only: 0 = Monday … 6 = Sunday; empty = the weekday of the start. */
  weekdays: readonly number[];
  /** Last possible date (inclusive). */
  until: DateString | null;
  /** Total number of occurrences, the first one included. */
  count: number | null;
}

/** 0 = Monday … 6 = Sunday. */
const mondayIndex = (date: DateString): number => (weekday(date) + 6) % 7;

/** The same day of a later month, or its last day when that month is shorter. */
function monthsLater(start: DateString, months: number): DateString {
  return addMonths(start, months);
}

/**
 * The start dates of a series that fall between `from` and `to` (both inclusive), in order. `count` and `until` end the
 * series; an open-ended series simply goes on. Pure: nothing is stored per occurrence (ADR 0028).
 */
export function occurrenceStarts(
  start: DateString,
  rule: RecurrenceRule,
  from: DateString,
  to: DateString,
): DateString[] {
  const last = rule.until !== null && rule.until < to ? rule.until : to;
  if (last < from || last < start) return [];
  const result: DateString[] = [];
  const take = (date: DateString, index: number): 'stop' | 'next' => {
    if (rule.count !== null && index >= rule.count) return 'stop';
    if (date > last) return 'stop';
    if (date >= from && date >= start) {
      result.push(date);
      if (result.length >= MAX_OCCURRENCES) return 'stop';
    }
    return 'next';
  };
  const interval = Math.max(1, rule.interval);

  if (rule.freq === 'daily') {
    const skip = from > start ? Math.floor(daysBetween(start, from) / interval) : 0;
    for (let k = skip; ; k++) {
      if (take(addDays(start, k * interval), k) === 'stop') break;
    }
  } else if (rule.freq === 'weekly') {
    const days = [...new Set(rule.weekdays.length ? rule.weekdays : [mondayIndex(start)])].sort(
      (a, b) => a - b,
    );
    const firstMonday = addDays(start, -mondayIndex(start));
    // Occurrences of the first week that are on or after the start.
    const firstWeek = days.filter((d) => d >= mondayIndex(start));
    const skipBlocks =
      from > start
        ? Math.max(0, Math.floor(daysBetween(firstMonday, from) / (7 * interval)) - 1)
        : 0;
    outer: for (let block = skipBlocks; ; block++) {
      const monday = addDays(firstMonday, block * 7 * interval);
      if (monday > last) break;
      const inBlock = block === 0 ? firstWeek : days;
      const base = block === 0 ? 0 : firstWeek.length + (block - 1) * days.length;
      for (let i = 0; i < inBlock.length; i++) {
        if (take(addDays(monday, inBlock[i]!), base + i) === 'stop') break outer;
      }
    }
  } else if (rule.freq === 'monthly') {
    for (let k = 0; ; k++) {
      if (take(monthsLater(start, k * interval), k) === 'stop') break;
    }
  } else {
    for (let k = 0; ; k++) {
      if (take(monthsLater(start, k * interval * 12), k) === 'stop') break;
    }
  }
  return result;
}

export interface Occurrence {
  startDate: DateString;
  endDate: DateString;
}

/**
 * The occurrences of a series that overlap a window, with the length of the event kept (a multi-day event starting before
 * the window still counts), minus the cancelled dates (identified by their start date).
 */
export function occurrencesIn(
  start: DateString,
  durationDays: number,
  rule: RecurrenceRule,
  from: DateString,
  to: DateString,
  cancelled: ReadonlySet<DateString> = new Set(),
): Occurrence[] {
  return occurrenceStarts(start, rule, addDays(from, -durationDays), to)
    .filter((date) => !cancelled.has(date))
    .map((date) => ({ startDate: date, endDate: addDays(date, durationDays) }));
}

/** Is this date one of the series' occurrences? Used to check the `occurrence` parameter of an edit or delete. */
export function isOccurrence(start: DateString, rule: RecurrenceRule, date: DateString): boolean {
  return occurrenceStarts(start, rule, date, date).length === 1;
}

// ----- API -------------------------------------------------------------------------------------

export const recurrenceRequestSchema = z
  .object({
    freq: z.enum(RECURRENCE_FREQS),
    interval: z.number().int().min(1).max(MAX_RECURRENCE_INTERVAL).default(1),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    until: dateOnlySchema.nullable().default(null),
    count: z.number().int().min(1).max(MAX_RECURRENCE_COUNT).nullable().default(null),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.until !== null && rule.count !== null) {
      ctx.addIssue({ code: 'custom', path: ['count'], message: 'until_or_count' });
    }
    if (rule.freq !== 'weekly' && rule.weekdays.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'weekdays_not_allowed' });
    }
    if (new Set(rule.weekdays).size !== rule.weekdays.length) {
      ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'duplicate' });
    }
  })
  .transform((rule) => ({ ...rule, weekdays: [...rule.weekdays].sort((a, b) => a - b) }));
export type RecurrenceRequest = z.infer<typeof recurrenceRequestSchema>;

export const recurrenceSchema = z.object({
  freq: z.enum(RECURRENCE_FREQS),
  interval: z.number().int(),
  weekdays: z.array(z.number().int()),
  until: z.string().nullable(),
  count: z.number().int().nullable(),
});

export const SERIES_MODES = ['all', 'this', 'following'] as const;
export type SeriesMode = (typeof SERIES_MODES)[number];

/** Which part of a series an edit or delete applies to. `this` and `following` need the occurrence date. */
export const seriesScopeQuerySchema = z
  .object({
    mode: z.enum(SERIES_MODES).default('all'),
    occurrence: dateOnlySchema.optional(),
  })
  .refine((v) => v.mode === 'all' || v.occurrence !== undefined, {
    path: ['occurrence'],
    error: 'required',
  });
export type SeriesScopeQuery = z.infer<typeof seriesScopeQuerySchema>;
