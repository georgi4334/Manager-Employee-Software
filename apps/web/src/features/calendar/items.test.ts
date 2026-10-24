import { describe, expect, it } from 'vitest';
import { itemsOnDay, type CalendarItem } from './items';

const item = (key: string, o: Partial<CalendarItem> = {}): CalendarItem => ({
  key,
  kind: 'personal',
  title: key,
  startDate: '2026-11-03',
  endDate: '2026-11-03',
  allDay: true,
  startTime: null,
  endTime: null,
  ...o,
});

describe('items on a day', () => {
  it('includes items that span the day, with inclusive ends, and no others', () => {
    const multi = item('multi', { startDate: '2026-11-02', endDate: '2026-11-04' });
    for (const [date, expected] of [
      ['2026-11-01', false],
      ['2026-11-02', true],
      ['2026-11-03', true],
      ['2026-11-04', true],
      ['2026-11-05', false],
    ] as const) {
      expect(itemsOnDay([multi], date).length === 1, date).toBe(expected);
    }
  });

  it('puts all-day items before timed ones, which are ordered by time', () => {
    const items = [
      item('late', { allDay: false, startTime: '15:00', endTime: '16:00' }),
      item('early', { allDay: false, startTime: '08:00', endTime: '09:00' }),
      item('party', { kind: 'company' }),
      item('holiday', { kind: 'holiday' }),
      item('leave', { kind: 'leave' }),
    ];
    expect(itemsOnDay(items, '2026-11-03').map((i) => i.key)).toEqual([
      'holiday',
      'leave',
      'party',
      'early',
      'late',
    ]);
  });

  it('shows a timed multi-day event as all day on its later days', () => {
    const night = item('night', {
      allDay: false,
      startTime: '22:00',
      endTime: '06:00',
      startDate: '2026-11-03',
      endDate: '2026-11-04',
    });
    const other = item('other', {
      allDay: false,
      startTime: '09:00',
      endTime: '10:00',
      startDate: '2026-11-04',
      endDate: '2026-11-04',
    });
    expect(itemsOnDay([other, night], '2026-11-04').map((i) => i.key)).toEqual(['night', 'other']);
  });
});
