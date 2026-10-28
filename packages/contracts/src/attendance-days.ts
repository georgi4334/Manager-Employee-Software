import type { AttendanceRecord, PresenceItem } from './attendance.js';
import { WORKDAY_MINUTES } from './capacity.js';

/**
 * How a day's recorded time compares with the 8-hour day. Informational only: nothing is blocked
 * or reported. `in_progress` while a record is still open, so a running day is never "short".
 */
export const ATTENDANCE_DAY_LEVELS = [
  'in_progress',
  'short',
  'almost',
  'complete',
  'over',
] as const;
export type AttendanceDayLevel = (typeof ATTENDANCE_DAY_LEVELS)[number];

/** Below this many minutes under the target a day is short (8 h − 1 h = 7 h). */
export const ATTENDANCE_SHORT_MARGIN = 60;
/** Up to this many minutes over the target still counts as a complete day (8:00–8:15). */
export const ATTENDANCE_OVER_TOLERANCE = 15;

export function attendanceDayLevel(
  minutes: number,
  { open = false, target = WORKDAY_MINUTES }: { open?: boolean; target?: number } = {},
): AttendanceDayLevel {
  if (open) return 'in_progress';
  if (minutes < target - ATTENDANCE_SHORT_MARGIN) return 'short';
  if (minutes < target) return 'almost';
  if (minutes <= target + ATTENDANCE_OVER_TOLERANCE) return 'complete';
  return 'over';
}

/** The day's target: 8 hours Monday to Friday, none on a weekend (any work there is extra). */
export function attendanceTarget(date: string): number {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6 ? 0 : WORKDAY_MINUTES;
}

/** Share of the target filled, 0–1 (an over-long day is a full bar; the level says it is over). */
export const attendanceProgress = (minutes: number, target = WORKDAY_MINUTES): number =>
  target <= 0 ? (minutes > 0 ? 1 : 0) : Math.min(1, Math.max(0, minutes / target));

export interface AttendanceDay {
  key: string;
  employee: AttendanceRecord['employee'];
  date: string;
  /** Finished minutes; an open record adds nothing until it is closed. */
  minutes: number;
  /** The day's target (`attendanceTarget`): 0 on a weekend. */
  target: number;
  open: boolean;
  level: AttendanceDayLevel;
  /** Records of the day, earliest first. */
  records: AttendanceRecord[];
}

/** Records grouped per person and day, so a split day reads as one day with one total. */
export function groupAttendanceDays(records: readonly AttendanceRecord[]): AttendanceDay[] {
  const days = new Map<string, AttendanceDay>();
  for (const record of records) {
    const key = `${record.employee.id}|${record.date}`;
    let day = days.get(key);
    if (!day) {
      day = {
        key,
        employee: record.employee,
        date: record.date,
        minutes: 0,
        target: attendanceTarget(record.date),
        open: false,
        level: 'short',
        records: [],
      };
      days.set(key, day);
    }
    day.records.push(record);
    day.minutes += record.minutes ?? 0;
    day.open ||= record.open;
  }
  return [...days.values()].map((day) => ({
    ...day,
    records: day.records.sort((a, b) => a.checkInAt.localeCompare(b.checkInAt)),
    level: attendanceDayLevel(day.minutes, { open: day.open, target: day.target }),
  }));
}

export const ATTENDANCE_SORTS = [
  'newest',
  'oldest',
  'most',
  'fewest',
  'attention',
  'name',
] as const;
export type AttendanceSort = (typeof ATTENDANCE_SORTS)[number];

/** Short and over-long days first, then almost, running, complete. */
const ATTENTION: Record<AttendanceDayLevel, number> = {
  short: 0,
  over: 1,
  almost: 2,
  in_progress: 3,
  complete: 4,
};

const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.lastName} ${p.firstName}`.toLocaleLowerCase();
const byName = (a: { firstName: string; lastName: string }, b: typeof a) =>
  fullName(a).localeCompare(fullName(b));

/** A sorted copy; ties fall back to newest day, then name, so the order is stable. */
export function sortAttendanceDays(
  days: readonly AttendanceDay[],
  sort: AttendanceSort,
): AttendanceDay[] {
  const newest = (a: AttendanceDay, b: AttendanceDay) =>
    b.date.localeCompare(a.date) || byName(a.employee, b.employee);
  const compare: Record<AttendanceSort, (a: AttendanceDay, b: AttendanceDay) => number> = {
    newest,
    oldest: (a, b) => a.date.localeCompare(b.date) || byName(a.employee, b.employee),
    most: (a, b) => b.minutes - a.minutes || newest(a, b),
    fewest: (a, b) => a.minutes - b.minutes || newest(a, b),
    attention: (a, b) => ATTENTION[a.level] - ATTENTION[b.level] || newest(a, b),
    name: (a, b) => byName(a.employee, b.employee) || b.date.localeCompare(a.date),
  };
  return [...days].sort(compare[sort]);
}

export const PRESENCE_SORTS = ['name', 'most', 'fewest', 'status'] as const;
export type PresenceSort = (typeof PRESENCE_SORTS)[number];

const PRESENCE_ORDER: Record<PresenceItem['state'], number> = {
  working: 0,
  done: 1,
  leave: 2,
  none: 3,
};

/** Who is in today, sorted; ties fall back to the name. */
export function sortPresence(items: readonly PresenceItem[], sort: PresenceSort): PresenceItem[] {
  const name = (a: PresenceItem, b: PresenceItem) => byName(a.employee, b.employee);
  const compare: Record<PresenceSort, (a: PresenceItem, b: PresenceItem) => number> = {
    name,
    most: (a, b) => b.minutes - a.minutes || name(a, b),
    fewest: (a, b) => a.minutes - b.minutes || name(a, b),
    status: (a, b) => PRESENCE_ORDER[a.state] - PRESENCE_ORDER[b.state] || name(a, b),
  };
  return [...items].sort(compare[sort]);
}
