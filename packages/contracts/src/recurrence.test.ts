import { describe, expect, it } from 'vitest';
import {
  MAX_OCCURRENCES,
  isOccurrence,
  occurrenceStarts,
  occurrencesIn,
  recurrenceRequestSchema,
  seriesScopeQuerySchema,
  type RecurrenceRule,
} from './recurrence.js';

const rule = (o: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  freq: 'daily',
  interval: 1,
  weekdays: [],
  until: null,
  count: null,
  ...o,
});

// 2026-10-26 is a Monday.
describe('daily', () => {
  it('lists every day of the window from the start on', () => {
    expect(occurrenceStarts('2026-10-26', rule(), '2026-10-25', '2026-10-29')).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
    ]);
  });

  it('honours the interval and finds the right days far from the start', () => {
    // 1 January + 3 days × k: 22 October is day 294, so 22, 25, 28 and 31 October are occurrences
    expect(
      occurrenceStarts('2026-01-01', rule({ interval: 3 }), '2026-10-20', '2026-10-31'),
    ).toEqual(['2026-10-22', '2026-10-25', '2026-10-28', '2026-10-31']);
  });

  it('stops after count occurrences and at until (inclusive)', () => {
    expect(occurrenceStarts('2026-10-26', rule({ count: 3 }), '2026-10-01', '2026-12-31')).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
    ]);
    expect(
      occurrenceStarts('2026-10-26', rule({ until: '2026-10-28' }), '2026-10-01', '2026-12-31'),
    ).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
  });

  it('counts from the first occurrence even when the window starts later', () => {
    expect(occurrenceStarts('2026-10-26', rule({ count: 5 }), '2026-10-29', '2026-12-31')).toEqual([
      '2026-10-29',
      '2026-10-30',
    ]);
  });

  it('is empty before the start, after the end and for an inverted window', () => {
    expect(occurrenceStarts('2026-10-26', rule(), '2026-10-01', '2026-10-25')).toEqual([]);
    expect(
      occurrenceStarts('2026-10-26', rule({ until: '2026-10-27' }), '2026-11-01', '2026-11-30'),
    ).toEqual([]);
    expect(occurrenceStarts('2026-10-26', rule(), '2026-11-02', '2026-11-01')).toEqual([]);
  });

  it('never returns more than the safety limit', () => {
    expect(occurrenceStarts('2026-01-01', rule(), '2026-01-01', '2030-12-31')).toHaveLength(
      MAX_OCCURRENCES,
    );
  });
});

describe('weekly', () => {
  it('repeats on the weekday of the start when none is chosen', () => {
    expect(
      occurrenceStarts('2026-10-28', rule({ freq: 'weekly' }), '2026-10-01', '2026-11-20'),
    ).toEqual(['2026-10-28', '2026-11-04', '2026-11-11', '2026-11-18']);
  });

  it('repeats on several weekdays, without the days of the first week before the start', () => {
    // Monday, Wednesday, Friday; the event starts on Wednesday 28 October
    const r = rule({ freq: 'weekly', weekdays: [0, 2, 4] });
    expect(occurrenceStarts('2026-10-28', r, '2026-10-01', '2026-11-08')).toEqual([
      '2026-10-28',
      '2026-10-30',
      '2026-11-02',
      '2026-11-04',
      '2026-11-06',
    ]);
  });

  it('skips weeks with an interval of two', () => {
    const r = rule({ freq: 'weekly', interval: 2, weekdays: [1] });
    expect(occurrenceStarts('2026-10-27', r, '2026-10-01', '2026-12-01')).toEqual([
      '2026-10-27',
      '2026-11-10',
      '2026-11-24',
    ]);
  });

  it('counts occurrences across weekdays and weeks', () => {
    const r = rule({ freq: 'weekly', weekdays: [0, 2, 4], count: 4 });
    expect(occurrenceStarts('2026-10-28', r, '2026-10-01', '2026-12-31')).toEqual([
      '2026-10-28',
      '2026-10-30',
      '2026-11-02',
      '2026-11-04',
    ]);
  });

  it('finds the right days when the window is far from the start', () => {
    const r = rule({ freq: 'weekly', weekdays: [0, 3] });
    const all = occurrenceStarts('2026-01-05', r, '2026-01-01', '2027-01-31');
    const late = occurrenceStarts('2026-01-05', r, '2026-09-01', '2026-09-30');
    expect(late).toEqual(all.filter((d) => d >= '2026-09-01' && d <= '2026-09-30'));
    expect(late.length).toBeGreaterThan(5);
  });

  it('ignores duplicate weekdays', () => {
    const r = rule({ freq: 'weekly', weekdays: [2, 2, 2] });
    expect(occurrenceStarts('2026-10-28', r, '2026-10-28', '2026-11-05')).toEqual([
      '2026-10-28',
      '2026-11-04',
    ]);
  });
});

describe('monthly and yearly', () => {
  it('repeats on the day of the month and clamps short months', () => {
    expect(
      occurrenceStarts('2026-01-31', rule({ freq: 'monthly' }), '2026-01-01', '2026-05-31'),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('honours the interval and the count', () => {
    expect(
      occurrenceStarts(
        '2026-10-15',
        rule({ freq: 'monthly', interval: 3, count: 3 }),
        '2026-01-01',
        '2028-01-01',
      ),
    ).toEqual(['2026-10-15', '2027-01-15', '2027-04-15']);
  });

  it('repeats every year, 29 February becomes 28 February in other years', () => {
    expect(
      occurrenceStarts('2024-02-29', rule({ freq: 'yearly' }), '2024-01-01', '2028-12-31'),
    ).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });

  it('stops at the end date', () => {
    expect(
      occurrenceStarts(
        '2026-10-15',
        rule({ freq: 'monthly', until: '2026-12-15' }),
        '2026-01-01',
        '2027-12-31',
      ),
    ).toEqual(['2026-10-15', '2026-11-15', '2026-12-15']);
  });
});

describe('occurrencesIn', () => {
  it('keeps the length of a multi-day event and includes one that began before the window', () => {
    const r = rule({ freq: 'weekly' });
    const list = occurrencesIn('2026-10-26', 2, r, '2026-11-03', '2026-11-05');
    // Monday 2 November lasts until Wednesday 4 November and overlaps the window
    expect(list).toEqual([{ startDate: '2026-11-02', endDate: '2026-11-04' }]);
  });

  it('leaves out cancelled occurrences', () => {
    const r = rule();
    const list = occurrencesIn(
      '2026-10-26',
      0,
      r,
      '2026-10-26',
      '2026-10-28',
      new Set(['2026-10-27']),
    );
    expect(list.map((o) => o.startDate)).toEqual(['2026-10-26', '2026-10-28']);
  });
});

describe('isOccurrence', () => {
  it('is true for dates of the series only', () => {
    const r = rule({ freq: 'weekly', weekdays: [0, 2] });
    expect(isOccurrence('2026-10-26', r, '2026-10-28')).toBe(true);
    expect(isOccurrence('2026-10-26', r, '2026-10-27')).toBe(false);
    expect(isOccurrence('2026-10-26', r, '2026-10-19')).toBe(false); // before the start
  });
});

describe('recurrenceRequestSchema', () => {
  it('accepts a rule, fills the defaults and sorts the weekdays', () => {
    const parsed = recurrenceRequestSchema.parse({ freq: 'weekly', weekdays: [4, 0, 2] });
    expect(parsed).toEqual({
      freq: 'weekly',
      interval: 1,
      weekdays: [0, 2, 4],
      until: null,
      count: null,
    });
  });

  it.each([
    ['both an end date and a count', { freq: 'daily', until: '2027-01-01', count: 3 }],
    ['weekdays on a daily rule', { freq: 'daily', weekdays: [1] }],
    ['a duplicate weekday', { freq: 'weekly', weekdays: [1, 1] }],
    ['a weekday above 6', { freq: 'weekly', weekdays: [7] }],
    ['an interval of 0', { freq: 'daily', interval: 0 }],
    ['an interval above 30', { freq: 'daily', interval: 31 }],
    ['a count of 0', { freq: 'daily', count: 0 }],
    ['a count above 500', { freq: 'daily', count: 501 }],
    ['an unknown frequency', { freq: 'hourly' }],
    ['a bad end date', { freq: 'daily', until: '2027-13-01' }],
    ['an unknown field', { freq: 'daily', extra: 1 }],
  ])('refuses %s', (_name, body) => {
    expect(recurrenceRequestSchema.safeParse(body).success).toBe(false);
  });

  it('accepts the limits', () => {
    expect(
      recurrenceRequestSchema.safeParse({ freq: 'daily', interval: 30, count: 500 }).success,
    ).toBe(true);
    expect(
      recurrenceRequestSchema.safeParse({ freq: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] })
        .success,
    ).toBe(true);
  });
});

describe('seriesScopeQuerySchema', () => {
  it('defaults to the whole series', () => {
    expect(seriesScopeQuerySchema.parse({})).toEqual({ mode: 'all' });
  });
  it('needs the occurrence for this and following', () => {
    expect(seriesScopeQuerySchema.safeParse({ mode: 'this' }).success).toBe(false);
    expect(seriesScopeQuerySchema.safeParse({ mode: 'following' }).success).toBe(false);
    expect(
      seriesScopeQuerySchema.safeParse({ mode: 'this', occurrence: '2026-10-27' }).success,
    ).toBe(true);
    expect(
      seriesScopeQuerySchema.safeParse({ mode: 'all', occurrence: '2026-10-27' }).success,
    ).toBe(true);
  });
  it('refuses an unknown mode and a bad date', () => {
    expect(seriesScopeQuerySchema.safeParse({ mode: 'some' }).success).toBe(false);
    expect(seriesScopeQuerySchema.safeParse({ mode: 'this', occurrence: 'soon' }).success).toBe(
      false,
    );
  });
});
