import { describe, expect, it } from 'vitest';
import type { AttendanceRecord, PresenceItem } from './attendance.js';
import {
  attendanceDayLevel,
  attendanceProgress,
  attendanceTarget,
  groupAttendanceDays,
  sortAttendanceDays,
  sortPresence,
} from './attendance-days.js';

const person = (id: string, firstName: string, lastName: string) => ({
  id: `0192f5a0-0000-7000-8000-${id.padStart(12, '0')}`,
  firstName,
  lastName,
});
const ada = person('1', 'Ada', 'Lovelace');
const bob = person('2', 'Bob', 'Baker');

let seq = 0;
function record(o: Partial<AttendanceRecord> & Pick<AttendanceRecord, 'date'>): AttendanceRecord {
  seq += 1;
  return {
    id: `0192f5a0-0000-7000-9000-${String(seq).padStart(12, '0')}`,
    employee: ada,
    startTime: '09:00',
    endTime: '17:00',
    checkInAt: `${o.date}T07:00:00Z`,
    checkOutAt: `${o.date}T15:00:00Z`,
    minutes: 480,
    mode: 'office',
    note: null,
    source: 'clock',
    open: false,
    canEdit: true,
    ...o,
  };
}

describe('attendanceDayLevel', () => {
  it('is short below 7 h, almost up to 8 h, complete up to 8:15 and over after', () => {
    expect(attendanceDayLevel(0)).toBe('short');
    expect(attendanceDayLevel(419)).toBe('short');
    expect(attendanceDayLevel(420)).toBe('almost');
    expect(attendanceDayLevel(479)).toBe('almost');
    expect(attendanceDayLevel(480)).toBe('complete');
    expect(attendanceDayLevel(495)).toBe('complete');
    expect(attendanceDayLevel(496)).toBe('over');
  });

  it('never calls a running day short or over', () => {
    expect(attendanceDayLevel(10, { open: true })).toBe('in_progress');
    expect(attendanceDayLevel(900, { open: true })).toBe('in_progress');
  });

  it('measures against another target when given', () => {
    expect(attendanceDayLevel(240, { target: 240 })).toBe('complete');
    expect(attendanceDayLevel(179, { target: 240 })).toBe('short');
  });
});

describe('attendanceTarget', () => {
  it('is 8 hours on weekdays and nothing on a weekend', () => {
    expect(attendanceTarget('2026-10-26')).toBe(480); // Monday
    expect(attendanceTarget('2026-10-30')).toBe(480); // Friday
    expect(attendanceTarget('2026-10-24')).toBe(0); // Saturday
    expect(attendanceTarget('2026-10-25')).toBe(0); // Sunday
  });

  it('makes any real weekend work extra time, never short', () => {
    expect(attendanceDayLevel(10, { target: 0 })).toBe('complete');
    expect(attendanceDayLevel(120, { target: 0 })).toBe('over');
    const [day] = groupAttendanceDays([record({ date: '2026-10-24', minutes: 180 })]);
    expect(day!.target).toBe(0);
    expect(day!.level).toBe('over');
  });
});

describe('attendanceProgress', () => {
  it('is the share of the day, clamped to 0–1', () => {
    expect(attendanceProgress(240)).toBe(0.5);
    expect(attendanceProgress(0)).toBe(0);
    expect(attendanceProgress(600)).toBe(1);
    expect(attendanceProgress(-5)).toBe(0);
    expect(attendanceProgress(100, 0)).toBe(1);
    expect(attendanceProgress(0, 0)).toBe(0);
  });
});

describe('groupAttendanceDays', () => {
  it('adds up the records of one person and day, earliest first', () => {
    const late = record({
      date: '2026-10-27',
      checkInAt: '2026-10-27T20:01:00Z',
      minutes: 1,
    });
    const early = record({ date: '2026-10-27', checkInAt: '2026-10-27T11:14:00Z', minutes: 480 });
    const [day, ...rest] = groupAttendanceDays([late, early]);
    expect(rest).toHaveLength(0);
    expect(day!.minutes).toBe(481);
    expect(day!.records.map((r) => r.id)).toEqual([early.id, late.id]);
    expect(day!.level).toBe('complete');
  });

  it('keeps people and days apart', () => {
    const days = groupAttendanceDays([
      record({ date: '2026-10-27' }),
      record({ date: '2026-10-28' }),
      record({ date: '2026-10-27', employee: bob }),
    ]);
    expect(days).toHaveLength(3);
  });

  it('marks a day with an open record as running and does not count the open record', () => {
    const [day] = groupAttendanceDays([
      record({ date: '2026-10-28', minutes: 120 }),
      record({ date: '2026-10-28', minutes: null, open: true, endTime: null }),
    ]);
    expect(day!.open).toBe(true);
    expect(day!.minutes).toBe(120);
    expect(day!.level).toBe('in_progress');
  });

  it('returns nothing for no records', () => {
    expect(groupAttendanceDays([])).toEqual([]);
  });
});

describe('sortAttendanceDays', () => {
  const days = groupAttendanceDays([
    record({ date: '2026-10-26', minutes: 300 }), // short
    record({ date: '2026-10-27', minutes: 480 }), // complete
    record({ date: '2026-10-28', minutes: 600 }), // over
    record({ date: '2026-10-27', employee: bob, minutes: 450 }), // almost
  ]);
  const order = (sort: Parameters<typeof sortAttendanceDays>[1]) =>
    sortAttendanceDays(days, sort).map((d) => `${d.employee.firstName} ${d.date}`);

  it('sorts by date both ways, ties by name', () => {
    expect(order('newest')).toEqual([
      'Ada 2026-10-28',
      'Bob 2026-10-27',
      'Ada 2026-10-27',
      'Ada 2026-10-26',
    ]);
    expect(order('oldest')).toEqual([
      'Ada 2026-10-26',
      'Bob 2026-10-27',
      'Ada 2026-10-27',
      'Ada 2026-10-28',
    ]);
  });

  it('sorts by hours both ways', () => {
    expect(order('most')[0]).toBe('Ada 2026-10-28');
    expect(order('fewest')[0]).toBe('Ada 2026-10-26');
  });

  it('puts days that need attention first', () => {
    expect(order('attention')).toEqual([
      'Ada 2026-10-26',
      'Ada 2026-10-28',
      'Bob 2026-10-27',
      'Ada 2026-10-27',
    ]);
  });

  it('sorts by last name, then newest day', () => {
    expect(order('name')[0]).toBe('Bob 2026-10-27');
    expect(order('name').slice(1)).toEqual(['Ada 2026-10-28', 'Ada 2026-10-27', 'Ada 2026-10-26']);
  });

  it('does not change the input', () => {
    const before = days.map((d) => d.key);
    sortAttendanceDays(days, 'fewest');
    expect(days.map((d) => d.key)).toEqual(before);
  });
});

describe('sortPresence', () => {
  const item = (
    employee: PresenceItem['employee'],
    state: PresenceItem['state'],
    minutes: number,
  ): PresenceItem => ({ employee, state, mode: null, since: null, minutes });
  const cleo = person('3', 'Cleo', 'Adams');
  const items = [item(ada, 'done', 480), item(bob, 'working', 60), item(cleo, 'none', 0)];
  const names = (sort: Parameters<typeof sortPresence>[1]) =>
    sortPresence(items, sort).map((i) => i.employee.firstName);

  it('sorts by name, hours and status', () => {
    expect(names('name')).toEqual(['Cleo', 'Bob', 'Ada']);
    expect(names('most')).toEqual(['Ada', 'Bob', 'Cleo']);
    expect(names('fewest')).toEqual(['Cleo', 'Bob', 'Ada']);
    expect(names('status')).toEqual(['Bob', 'Ada', 'Cleo']);
  });
});
