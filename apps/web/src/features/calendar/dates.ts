import { addDays, daysBetween } from '@intime/contracts';

export const CALENDAR_VIEWS = ['month', 'week', 'day', 'agenda'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const AGENDA_DAYS = 30;

/** 0 = Monday … 6 = Sunday. */
export const weekdayOf = (date: string): number =>
  (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

export const startOfWeek = (date: string): string => addDays(date, -weekdayOf(date));

export const firstOfMonth = (date: string): string => `${date.slice(0, 7)}-01`;

export function addMonths(date: string, months: number): string {
  const [year = 0, month = 1] = date.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

export const monthOf = (date: string): string => date.slice(0, 7);

/** The days a view shows: a month fills whole weeks (6 rows), so it is always 42 days. */
export function rangeFor(view: CalendarView, anchor: string): { from: string; to: string } {
  switch (view) {
    case 'month': {
      const from = startOfWeek(firstOfMonth(anchor));
      return { from, to: addDays(from, 41) };
    }
    case 'week': {
      const from = startOfWeek(anchor);
      return { from, to: addDays(from, 6) };
    }
    case 'day':
      return { from: anchor, to: anchor };
    case 'agenda':
      return { from: anchor, to: addDays(anchor, AGENDA_DAYS - 1) };
  }
}

/** Move one step back (-1) or forward (+1). Months land on the first day. */
export function shift(view: CalendarView, anchor: string, direction: -1 | 1): string {
  switch (view) {
    case 'month':
      return addMonths(anchor, direction);
    case 'week':
      return addDays(anchor, 7 * direction);
    case 'day':
      return addDays(anchor, direction);
    case 'agenda':
      return addDays(anchor, AGENDA_DAYS * direction);
  }
}

export const eachDay = (from: string, to: string): string[] =>
  Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i));

export const yearsIn = (from: string, to: string): number[] => {
  const first = Number(from.slice(0, 4));
  const last = Number(to.slice(0, 4));
  return first === last ? [first] : [first, last];
};
