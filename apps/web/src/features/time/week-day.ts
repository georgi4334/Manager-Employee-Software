import type { TimeWeek } from '@intime/contracts';

/**
 * The day the chart opens on: the one selected if it belongs to the week, else today when it is in the week,
 * else the first day with time logged, else the first day.
 */
export function openDay(
  week: Pick<TimeWeek, 'days' | 'entries'>,
  today: string,
  selected: string | null,
): string {
  const dates = week.days.map((d) => d.date);
  if (selected && dates.includes(selected)) return selected;
  if (dates.includes(today)) return today;
  const logged = week.days.find((d) => week.entries.some((e) => e.workDate === d.date));
  return logged?.date ?? dates[0] ?? today;
}
