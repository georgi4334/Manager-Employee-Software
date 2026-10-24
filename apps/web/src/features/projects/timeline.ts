import { daysBetween } from '@intime/contracts';

/**
 * Where a date lies between the start and the end of a project, as 0-100 (clamped). A project that starts and ends
 * on the same day is at 0 before, 100 on and after that day.
 */
export function positionPct(date: string, start: string, end: string): number {
  const span = daysBetween(start, end);
  if (span <= 0) return date < start ? 0 : 100;
  const pct = (daysBetween(start, date) / span) * 100;
  return Math.min(100, Math.max(0, Math.round(pct * 10) / 10));
}
