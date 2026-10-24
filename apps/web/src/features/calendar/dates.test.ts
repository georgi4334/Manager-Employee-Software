import { describe, expect, it } from 'vitest';
import {
  addMonths,
  eachDay,
  firstOfMonth,
  rangeFor,
  shift,
  startOfWeek,
  weekdayOf,
  yearsIn,
} from './dates';

describe('weeks start on Monday', () => {
  it('knows the weekday', () => {
    expect(weekdayOf('2026-10-26')).toBe(0); // Monday
    expect(weekdayOf('2026-10-24')).toBe(5); // Saturday
    expect(weekdayOf('2026-10-25')).toBe(6); // Sunday
  });
  it('finds the Monday of a week, also across month and year ends', () => {
    expect(startOfWeek('2026-10-24')).toBe('2026-10-19');
    expect(startOfWeek('2026-10-26')).toBe('2026-10-26');
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28');
  });
});

describe('ranges', () => {
  it('fills a month with 6 whole weeks', () => {
    expect(rangeFor('month', '2026-10-24')).toEqual({ from: '2026-09-28', to: '2026-11-08' });
    expect(eachDay('2026-09-28', '2026-11-08')).toHaveLength(42);
    expect(rangeFor('month', '2026-02-10')).toEqual({ from: '2026-01-26', to: '2026-03-08' });
  });
  it('keeps every view within the 93 days the API allows', () => {
    for (const view of ['month', 'week', 'day', 'agenda'] as const) {
      const { from, to } = rangeFor(view, '2026-10-24');
      expect(eachDay(from, to).length).toBeLessThanOrEqual(93);
    }
  });
  it('gives a week, a day and 30 agenda days', () => {
    expect(rangeFor('week', '2026-10-24')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(rangeFor('day', '2026-10-24')).toEqual({ from: '2026-10-24', to: '2026-10-24' });
    expect(
      eachDay(rangeFor('agenda', '2026-10-24').from, rangeFor('agenda', '2026-10-24').to),
    ).toHaveLength(30);
  });
});

describe('moving', () => {
  it('moves months over year ends and lands on the first', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01');
    expect(firstOfMonth('2026-10-24')).toBe('2026-10-01');
    expect(shift('month', '2026-10-24', 1)).toBe('2026-11-01');
    expect(shift('month', '2026-10-24', -1)).toBe('2026-09-01');
  });
  it('moves weeks, days and agenda pages', () => {
    expect(shift('week', '2026-10-24', 1)).toBe('2026-10-31');
    expect(shift('day', '2026-10-01', -1)).toBe('2026-09-30');
    expect(shift('agenda', '2026-10-24', 1)).toBe('2026-11-23');
  });
  it('lists the years a range touches', () => {
    expect(yearsIn('2026-12-28', '2027-01-03')).toEqual([2026, 2027]);
    expect(yearsIn('2026-10-01', '2026-10-31')).toEqual([2026]);
  });
});
