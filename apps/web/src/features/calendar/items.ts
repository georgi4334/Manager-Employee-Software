import type { CalendarEvent } from '@intime/contracts';

export type ItemKind = 'personal' | 'team' | 'company' | 'leave' | 'holiday';
export const ITEM_KINDS: readonly ItemKind[] = ['personal', 'team', 'company', 'leave', 'holiday'];

/** Everything the calendar shows, from events and from the read-only leave and holiday layers. */
export interface CalendarItem {
  key: string;
  kind: ItemKind;
  title: string;
  /** The person for leave items, the country for public holidays. */
  who?: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  /** Leave that still waits for a decision. */
  pending?: boolean;
  event?: CalendarEvent;
}

export const itemFromEvent = (event: CalendarEvent): CalendarItem => ({
  key: `event:${event.id}:${event.occurrenceDate}`,
  kind: event.scope,
  title: event.title,
  startDate: event.startDate,
  endDate: event.endDate,
  allDay: event.allDay,
  startTime: event.startTime,
  endTime: event.endTime,
  event,
});

export const onDay = (item: CalendarItem, date: string): boolean =>
  item.startDate <= date && date <= item.endDate;

/** All-day items first (holidays, leave, then events), then timed ones by time, then by title. */
const ORDER: Record<ItemKind, number> = { holiday: 0, leave: 1, company: 2, team: 3, personal: 4 };
export function itemsOnDay(items: readonly CalendarItem[], date: string): CalendarItem[] {
  return items
    .filter((item) => onDay(item, date))
    .sort((a, b) => {
      const aTimed = !a.allDay && a.startDate === date;
      const bTimed = !b.allDay && b.startDate === date;
      if (aTimed !== bTimed) return aTimed ? 1 : -1;
      if (aTimed && bTimed && a.startTime !== b.startTime) {
        return (a.startTime ?? '').localeCompare(b.startTime ?? '');
      }
      return (
        ORDER[a.kind] - ORDER[b.kind] ||
        a.title.localeCompare(b.title) ||
        a.key.localeCompare(b.key)
      );
    });
}
