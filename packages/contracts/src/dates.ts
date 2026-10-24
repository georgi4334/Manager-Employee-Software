/** Calendar dates are plain "YYYY-MM-DD" strings (no time zone); all arithmetic is done in UTC. */

export type DateString = string;

const DAY_MS = 86_400_000;

const toUtc = (date: DateString): number => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (ms: number): DateString => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: DateString, days: number): DateString {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: DateString): number {
  return new Date(toUtc(date)).getUTCDay();
}

export const isWeekend = (date: DateString): boolean => weekday(date) === 0 || weekday(date) === 6;

/** Whole days from a to b (negative when b is earlier). */
export function daysBetween(a: DateString, b: DateString): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** Every date from start to end, both included; empty when end is before start. */
export function eachDay(start: DateString, end: DateString): DateString[] {
  const count = daysBetween(start, end);
  return count < 0 ? [] : Array.from({ length: count + 1 }, (_, i) => addDays(start, i));
}

export const yearOf = (date: DateString): number => Number(date.slice(0, 4));

/** Today's date in an IANA time zone (the workspace's), e.g. "2026-10-24". Falls back to UTC for unknown zones. */
export function todayIn(timeZone: string, now: Date = new Date()): DateString {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
