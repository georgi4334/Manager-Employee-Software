import { daysBetween, eachDay, isWeekend, yearOf, type DateString } from './dates.js';

/** A public or company holiday on a date; a half-day holiday leaves half a working day. */
export interface HolidayOnDate {
  halfDay: boolean;
}

export interface LeaveDay {
  date: DateString;
  /** 1 = a whole working day, 0.5 = half a day. */
  fraction: 0.5 | 1;
}

export interface CountInput {
  start: DateString;
  end: DateString;
  /** The first day is taken from the afternoon only: it counts 0.5. */
  halfDayStart: boolean;
  /** The last day is taken until noon only: it counts 0.5. */
  halfDayEnd: boolean;
  holidays: ReadonlyMap<DateString, HolidayOnDate>;
}

export const MAX_LEAVE_RANGE_DAYS = 366;

export type CountProblem = 'end_before_start' | 'too_long' | 'half_day_conflict';

/**
 * Counts the working days of a leave request: weekends and holidays never count, half-day flags and half-day
 * holidays count 0.5. Returns the problem instead of throwing, so callers map it to a validation error.
 */
export function countLeaveDays(
  input: CountInput,
): { ok: true; days: LeaveDay[]; total: number } | { ok: false; problem: CountProblem } {
  const { start, end, halfDayStart, halfDayEnd, holidays } = input;
  if (daysBetween(start, end) < 0) return { ok: false, problem: 'end_before_start' };
  if (daysBetween(start, end) + 1 > MAX_LEAVE_RANGE_DAYS) return { ok: false, problem: 'too_long' };
  // One day cannot be both "from the afternoon" and "until noon".
  if (start === end && halfDayStart && halfDayEnd)
    return { ok: false, problem: 'half_day_conflict' };

  const days: LeaveDay[] = [];
  for (const date of eachDay(start, end)) {
    if (isWeekend(date)) continue;
    const holiday = holidays.get(date);
    if (holiday && !holiday.halfDay) continue;
    let fraction: 0.5 | 1 = holiday ? 0.5 : 1;
    if ((date === start && halfDayStart) || (date === end && halfDayEnd)) fraction = 0.5;
    days.push({ date, fraction });
  }
  return { ok: true, days, total: sum(days.map((d) => d.fraction)) };
}

/** Sum without floating point noise (all values are multiples of 0.5). */
export const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + Math.round(value * 2), 0) / 2;

/** Rounds to the nearest half day (0.25 rounds up). */
export const roundToHalf = (value: number): number => Math.round(value * 2) / 2;

/** Counted days of a request split by calendar year (a request over New Year touches two balances). */
export function daysByYear(days: readonly LeaveDay[]): Map<number, number> {
  const byYear = new Map<number, number>();
  for (const day of days) {
    const year = yearOf(day.date);
    byYear.set(year, sum([byYear.get(year) ?? 0, day.fraction]));
  }
  return byYear;
}

/**
 * Yearly allowance for someone who joined during the year: proportional to the days left in the year, rounded to
 * half days. Joining in an earlier year (or without a known hire date) gives the full allowance.
 */
export function proratedAllowance(
  allowance: number,
  hireDate: DateString | null,
  year: number,
): number {
  if (!hireDate || yearOf(hireDate) < year) return allowance;
  if (yearOf(hireDate) > year) return 0;
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  const total = daysBetween(first, last) + 1;
  const remaining = daysBetween(hireDate, last) + 1;
  return roundToHalf((allowance * remaining) / total);
}

/** What moves from last year into this one: the unused remainder, never negative, capped by the policy. */
export const carryOver = (previousRemaining: number, cap: number): number =>
  Math.min(Math.max(0, previousRemaining), Math.max(0, cap));

export interface BalanceFigures {
  entitled: number;
  carriedOver: number;
  adjustment: number;
  used: number;
  pending: number;
}

export const remainingDays = (b: BalanceFigures): number =>
  sum([b.entitled, b.carriedOver, b.adjustment]) - sum([b.used, b.pending]);
