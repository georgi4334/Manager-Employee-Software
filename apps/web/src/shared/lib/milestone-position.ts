import { daysBetween } from '@intime/contracts';

/**
 * Where "today" sits on a track of evenly spaced dated points, as 0–100 from the first point to the last: inside a
 * gap it moves with the days between the two neighbours. Before the first point it is 0, after the last 100. The
 * dates must be sorted (YYYY-MM-DD).
 */
export function milestonePosition(dates: readonly string[], today: string): number {
  if (dates.length < 2) return dates.length === 1 && today >= dates[0]! ? 100 : 0;
  const last = dates.length - 1;
  if (today <= dates[0]!) return 0;
  if (today >= dates[last]!) return 100;
  for (let i = 0; i < last; i += 1) {
    const from = dates[i]!;
    const to = dates[i + 1]!;
    if (today >= from && today < to) {
      const span = daysBetween(from, to);
      const frac = span > 0 ? daysBetween(from, today) / span : 0;
      return Math.round(((i + frac) / last) * 1000) / 10;
    }
  }
  return 100;
}
