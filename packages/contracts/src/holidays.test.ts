import { describe, expect, it } from 'vitest';
import { isWeekend } from './dates.js';
import {
  BUILT_IN_HOLIDAY_COUNTRIES,
  BUILT_IN_HOLIDAY_KEYS,
  isBuiltInHolidayKey,
  builtInHolidays,
  isBuiltInHolidayCountry,
  orthodoxEaster,
  westernEaster,
} from './holidays.js';

describe('Easter', () => {
  it.each([
    [2023, '2023-04-09'],
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
  ])('western %i', (year, date) => {
    expect(westernEaster(year)).toBe(date);
  });

  it.each([
    [2023, '2023-04-16'],
    [2024, '2024-05-05'],
    [2025, '2025-04-20'],
    [2026, '2026-04-12'],
    [2027, '2027-05-02'],
  ])('orthodox %i', (year, date) => {
    expect(orthodoxEaster(year)).toBe(date);
  });

  it('is always a Sunday', () => {
    for (let year = 2000; year <= 2060; year++) {
      expect(new Date(`${westernEaster(year)}T00:00:00Z`).getUTCDay()).toBe(0);
      expect(new Date(`${orthodoxEaster(year)}T00:00:00Z`).getUTCDay()).toBe(0);
    }
  });
});

const byKey = (country: string, year: number) =>
  Object.fromEntries(builtInHolidays(country, year).map((h) => [h.key, h.date]));

describe('German national holidays', () => {
  it('has the nine national days with the Easter-based ones in the right place (2026)', () => {
    expect(byKey('DE', 2026)).toEqual({
      'DE.new_year': '2026-01-01',
      'DE.good_friday': '2026-04-03',
      'DE.easter_monday': '2026-04-06',
      'DE.labour_day': '2026-05-01',
      'DE.ascension_day': '2026-05-14',
      'DE.whit_monday': '2026-05-25',
      'DE.unity_day': '2026-10-03',
      'DE.christmas': '2026-12-25',
      'DE.christmas_second_day': '2026-12-26',
    });
  });

  it('follows Easter in a leap year (2024)', () => {
    const h = byKey('DE', 2024);
    expect(h['DE.good_friday']).toBe('2024-03-29');
    expect(h['DE.easter_monday']).toBe('2024-04-01');
    expect(h['DE.ascension_day']).toBe('2024-05-09');
    expect(h['DE.whit_monday']).toBe('2024-05-20');
  });

  it('does not move weekend holidays (Germany has no compensation days)', () => {
    expect(builtInHolidays('DE', 2026).some((h) => h.key.includes('compensation'))).toBe(false);
  });
});

describe('Bulgarian national holidays', () => {
  it('has the orthodox Easter days and the fixed days (2026)', () => {
    const h = byKey('BG', 2026);
    expect(h['BG.good_friday']).toBe('2026-04-10');
    expect(h['BG.holy_saturday']).toBe('2026-04-11');
    expect(h['BG.easter_sunday']).toBe('2026-04-12');
    expect(h['BG.easter_monday']).toBe('2026-04-13');
    expect(h['BG.liberation_day']).toBe('2026-03-03');
    expect(h['BG.labour_day']).toBe('2026-05-01');
    expect(h['BG.st_george']).toBe('2026-05-06');
    expect(h['BG.culture_day']).toBe('2026-05-24');
    expect(h['BG.independence_day']).toBe('2026-09-22');
    expect(h['BG.christmas']).toBe('2026-12-25');
  });

  it('moves a fixed holiday on a weekend to the next free working day (2026)', () => {
    const list = builtInHolidays('BG', 2026);
    const compensation = list.filter((h) => h.key === 'BG.compensation_day');
    // May 24 (Sun) -> Mon May 25, Sep 6 (Sun) -> Mon Sep 7, Dec 26 (Sat) -> Mon Dec 28
    expect(compensation.map((h) => [h.compensates, h.date])).toEqual([
      ['BG.culture_day', '2026-05-25'],
      ['BG.unification_day', '2026-09-07'],
      ['BG.christmas_second_day', '2026-12-28'],
    ]);
  });

  it('puts two weekend holidays on two different working days (2027: Dec 25 Sat, Dec 26 Sun)', () => {
    const days = builtInHolidays('BG', 2027)
      .filter((h) => h.key === 'BG.compensation_day' && h.date.startsWith('2027-12'))
      .map((h) => h.date);
    expect(days).toEqual(['2027-12-27', '2027-12-28']);
  });

  it('never puts a compensation day on a weekend or on another holiday, or twice on one day', () => {
    for (let year = 2024; year <= 2035; year++) {
      const list = builtInHolidays('BG', year);
      const others = new Set(list.filter((h) => !h.compensates).map((h) => h.date));
      const compensation = list.filter((h) => h.compensates).map((h) => h.date);
      expect(new Set(compensation).size).toBe(compensation.length);
      for (const date of compensation) {
        expect(isWeekend(date)).toBe(false);
        expect(others.has(date)).toBe(false);
      }
    }
  });

  it("lets two holidays share a date (St George's Day on Easter Monday, 2024)", () => {
    const on = builtInHolidays('BG', 2024)
      .filter((h) => h.date === '2024-05-06')
      .map((h) => h.key);
    expect(on.sort()).toEqual(['BG.easter_monday', 'BG.st_george']);
  });
});

describe('holiday keys', () => {
  it('lists every key the calendars can produce, so the web app can translate them all', () => {
    const produced = new Set<string>();
    for (const country of BUILT_IN_HOLIDAY_COUNTRIES) {
      for (let year = 2000; year <= 2060; year++) {
        for (const h of builtInHolidays(country, year)) produced.add(h.key);
      }
    }
    expect([...produced].sort()).toEqual([...BUILT_IN_HOLIDAY_KEYS].sort());
  });

  it('recognises only known keys', () => {
    expect(isBuiltInHolidayKey('DE.unity_day')).toBe(true);
    expect(isBuiltInHolidayKey('DE.unknown')).toBe(false);
    expect(isBuiltInHolidayKey(undefined)).toBe(false);
  });
});

describe('builtInHolidays', () => {
  it('is sorted by date', () => {
    for (const country of BUILT_IN_HOLIDAY_COUNTRIES) {
      const dates = builtInHolidays(country, 2026).map((h) => h.date);
      expect(dates).toEqual([...dates].sort());
    }
  });

  it.each([null, undefined, '', 'FR', 'bg', 'XX'])('has none for %j', (country) => {
    expect(builtInHolidays(country, 2026)).toEqual([]);
    expect(isBuiltInHolidayCountry(country)).toBe(false);
  });
});
