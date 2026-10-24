import type { DateString } from './dates.js';

/** A local wall-clock time in a time zone, as plain strings. */
export interface LocalTime {
  date: DateString;
  /** "HH:MM", 24 hours. */
  time: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

function partsOf(ms: number, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(ms));
  const out: Record<string, number> = {};
  for (const part of parts) if (part.type !== 'literal') out[part.type] = Number(part.value);
  return out;
}

/** The local date and time of an instant in a time zone. */
export function utcToZoned(instant: Date | string | number, timeZone: string): LocalTime {
  const ms = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
  const p = partsOf(ms, timeZone);
  return {
    date: `${p.year}-${pad(p.month!)}-${pad(p.day!)}`,
    time: `${pad(p.hour!)}:${pad(p.minute!)}`,
  };
}

/** Offset of a time zone from UTC at an instant, in minutes (positive east of Greenwich). */
function offsetMinutes(ms: number, timeZone: string): number {
  const p = partsOf(ms, timeZone);
  const local = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!);
  return Math.round((local - Math.floor(ms / 60_000) * 60_000) / 60_000);
}

/**
 * The instant at which the clocks of a time zone show a date and time. A time that exists twice (clocks go
 * back) resolves to the first, earlier instant; a time that does not exist (clocks go forward) gives null.
 */
export function zonedToUtc(date: DateString, time: string, timeZone: string): Date | null {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const candidates = new Set<number>();
  // The offset may differ on the day before or after (daylight saving), so try both neighbours.
  for (const shift of [-1, 1]) {
    const offset = offsetMinutes(naive + shift * 86_400_000, timeZone);
    candidates.add(naive - offset * 60_000);
  }
  const valid = [...candidates]
    .filter((ms) => {
      const local = utcToZoned(ms, timeZone);
      return local.date === date && local.time === time;
    })
    .sort((a, b) => a - b);
  const first = valid[0];
  return first === undefined ? null : new Date(first);
}

/** Whole minutes between two instants. */
export const minutesBetween = (from: Date | string, to: Date | string): number =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);
