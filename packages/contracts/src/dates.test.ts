import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, eachDay, isWeekend, todayIn, weekday, yearOf } from './dates.js';

describe('date helpers', () => {
  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-24', 7)).toBe('2026-10-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('knows weekdays and weekends', () => {
    expect(weekday('2026-10-24')).toBe(6); // Saturday
    expect(weekday('2026-10-25')).toBe(0);
    expect(isWeekend('2026-10-24')).toBe(true);
    expect(isWeekend('2026-10-25')).toBe(true);
    expect(isWeekend('2026-10-26')).toBe(false);
  });

  it('counts days between dates in both directions', () => {
    expect(daysBetween('2026-10-24', '2026-10-24')).toBe(0);
    expect(daysBetween('2026-10-24', '2026-11-01')).toBe(8);
    expect(daysBetween('2026-11-01', '2026-10-24')).toBe(-8);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('lists days inclusively, and nothing for a backwards range', () => {
    expect(eachDay('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(eachDay('2026-10-30', '2026-10-30')).toEqual(['2026-10-30']);
    expect(eachDay('2026-10-30', '2026-10-29')).toEqual([]);
  });

  it('reads the year', () => {
    expect(yearOf('2026-12-31')).toBe(2026);
  });

  it('uses the date of the workspace time zone, which can differ from UTC', () => {
    const lateEveningUtc = new Date('2026-10-24T22:30:00Z');
    expect(todayIn('UTC', lateEveningUtc)).toBe('2026-10-24');
    expect(todayIn('Europe/Sofia', lateEveningUtc)).toBe('2026-10-25'); // UTC+3 in October
    expect(todayIn('America/Los_Angeles', lateEveningUtc)).toBe('2026-10-24');
  });

  it('falls back to UTC for an unknown time zone instead of failing', () => {
    expect(todayIn('Mars/Olympus', new Date('2026-10-24T10:00:00Z'))).toBe('2026-10-24');
  });
});
