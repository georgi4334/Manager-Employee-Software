import type { CalendarItem } from './items';

export const DAY_MINUTES = 24 * 60;

export const minutesOf = (time: string): number => {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
};

export interface Segment {
  item: CalendarItem;
  /** Minutes after midnight, local. */
  start: number;
  end: number;
  /** Side-by-side position among overlapping segments. */
  lane: number;
  lanes: number;
}

/** The part of a timed item that falls on one day (an event over midnight is cut per day). */
export function segmentOf(item: CalendarItem, date: string): { start: number; end: number } | null {
  if (item.allDay || !item.startTime || !item.endTime) return null;
  if (date < item.startDate || date > item.endDate) return null;
  const start = date === item.startDate ? minutesOf(item.startTime) : 0;
  const end = date === item.endDate ? minutesOf(item.endTime) : DAY_MINUTES;
  if (end <= start)
    return date === item.startDate ? { start, end: Math.min(start + 15, DAY_MINUTES) } : null;
  return { start, end };
}

/**
 * Places the timed items of one day: overlapping ones share the width (each cluster of
 * overlaps gets as many lanes as it needs at most), others take the full width.
 */
export function layoutDay(items: readonly CalendarItem[], date: string): Segment[] {
  const parts = items
    .map((item) => ({ item, part: segmentOf(item, date) }))
    .filter(
      (x): x is { item: CalendarItem; part: { start: number; end: number } } => x.part !== null,
    )
    .map(({ item, part }) => ({ item, ...part }))
    .sort((a, b) => a.start - b.start || b.end - a.end || a.item.key.localeCompare(b.item.key));

  const result: Segment[] = [];
  let cluster: Segment[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const close = () => {
    const lanes = laneEnds.length;
    for (const segment of cluster) segment.lanes = lanes;
    result.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const part of parts) {
    if (cluster.length > 0 && part.start >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= part.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(part.end);
    } else {
      laneEnds[lane] = part.end;
    }
    cluster.push({ ...part, lane, lanes: 1 });
    clusterEnd = Math.max(cluster.length === 1 ? part.end : clusterEnd, part.end);
  }
  if (cluster.length > 0) close();
  return result;
}

/** Items shown in the all-day row: all-day items and leave/holiday layers. */
export const allDayOn = (items: readonly CalendarItem[], date: string): CalendarItem[] =>
  items.filter((item) => item.allDay && item.startDate <= date && date <= item.endDate);

/** Saturday or Sunday. */
export const isWeekend = (date: string): boolean => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
};
