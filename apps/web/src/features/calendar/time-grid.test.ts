import { describe, expect, it } from 'vitest';
import type { CalendarItem } from './items';
import { allDayOn, isWeekend, layoutDay, minutesOf, segmentOf } from './time-grid';

const item = (key: string, over: Partial<CalendarItem> = {}): CalendarItem => ({
  key,
  kind: 'personal',
  title: key,
  startDate: '2026-10-27',
  endDate: '2026-10-27',
  allDay: false,
  startTime: '09:00',
  endTime: '10:00',
  ...over,
});

describe('minutesOf', () => {
  it.each([
    ['00:00', 0],
    ['09:30', 570],
    ['23:59', 1439],
  ])('%s is %i', (time, minutes) => expect(minutesOf(time)).toBe(minutes));
});

describe('segmentOf', () => {
  it('places a timed event on its day', () => {
    expect(segmentOf(item('a'), '2026-10-27')).toEqual({ start: 540, end: 600 });
  });
  it('ignores all-day items and other days', () => {
    expect(
      segmentOf(item('a', { allDay: true, startTime: null, endTime: null }), '2026-10-27'),
    ).toBeNull();
    expect(segmentOf(item('a'), '2026-10-28')).toBeNull();
  });
  it('cuts an event over midnight per day', () => {
    const late = item('late', { endDate: '2026-10-29', startTime: '22:00', endTime: '02:00' });
    expect(segmentOf(late, '2026-10-27')).toEqual({ start: 1320, end: 1440 });
    expect(segmentOf(late, '2026-10-28')).toEqual({ start: 0, end: 1440 });
    expect(segmentOf(late, '2026-10-29')).toEqual({ start: 0, end: 120 });
  });
  it('gives a zero-length event a visible minimum', () => {
    expect(segmentOf(item('z', { endTime: '09:00' }), '2026-10-27')).toEqual({
      start: 540,
      end: 555,
    });
  });
  it('drops a day where nothing remains (ends at midnight)', () => {
    expect(
      segmentOf(
        item('m', { endDate: '2026-10-28', startTime: '22:00', endTime: '00:00' }),
        '2026-10-28',
      ),
    ).toBeNull();
  });
});

describe('layoutDay', () => {
  it('gives separate events the full width', () => {
    const out = layoutDay(
      [item('a'), item('b', { startTime: '11:00', endTime: '12:00' })],
      '2026-10-27',
    );
    expect(out.map((s) => [s.item.key, s.lane, s.lanes])).toEqual([
      ['a', 0, 1],
      ['b', 0, 1],
    ]);
  });
  it('puts overlapping events side by side and reuses a free lane', () => {
    const out = layoutDay(
      [
        item('a', { startTime: '09:00', endTime: '11:00' }),
        item('b', { startTime: '09:30', endTime: '10:00' }),
        item('c', { startTime: '10:00', endTime: '10:30' }),
      ],
      '2026-10-27',
    );
    expect(out.map((s) => [s.item.key, s.lane, s.lanes])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 1, 2],
    ]);
  });
  it('treats touching events as not overlapping', () => {
    const out = layoutDay(
      [item('a'), item('b', { startTime: '10:00', endTime: '11:00' })],
      '2026-10-27',
    );
    expect(out.every((s) => s.lanes === 1)).toBe(true);
  });
  it('leaves out all-day items', () => {
    expect(
      layoutDay([item('h', { allDay: true, startTime: null, endTime: null })], '2026-10-27'),
    ).toEqual([]);
  });
});

describe('allDayOn and isWeekend', () => {
  it('lists all-day items covering the day', () => {
    const leave = item('l', {
      allDay: true,
      startTime: null,
      endTime: null,
      endDate: '2026-10-30',
    });
    expect(allDayOn([leave, item('t')], '2026-10-29').map((i) => i.key)).toEqual(['l']);
    expect(allDayOn([leave], '2026-10-31')).toEqual([]);
  });
  it.each([
    ['2026-10-31', true],
    ['2026-11-01', true],
    ['2026-11-02', false],
    ['2026-10-30', false],
  ])('%s weekend: %s', (date, weekend) => expect(isWeekend(date)).toBe(weekend));
});
