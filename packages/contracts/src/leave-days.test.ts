import { describe, expect, it } from 'vitest';
import {
  MAX_LEAVE_RANGE_DAYS,
  carryOver,
  countLeaveDays,
  daysByYear,
  proratedAllowance,
  remainingDays,
  roundToHalf,
  sum,
  type CountInput,
  type HolidayOnDate,
} from './leave-days.js';

const none = new Map<string, HolidayOnDate>();
const count = (input: Partial<CountInput> & Pick<CountInput, 'start' | 'end'>) =>
  countLeaveDays({ halfDayStart: false, halfDayEnd: false, holidays: none, ...input });
const total = (input: Parameters<typeof count>[0]) => {
  const result = count(input);
  if (!result.ok) throw new Error(result.problem);
  return result.total;
};

// 2026-10-26 is a Monday.
describe('countLeaveDays', () => {
  it('counts a working week as five days', () => {
    expect(total({ start: '2026-10-26', end: '2026-10-30' })).toBe(5);
  });

  it('skips weekends', () => {
    expect(total({ start: '2026-10-26', end: '2026-11-01' })).toBe(5);
    expect(total({ start: '2026-10-30', end: '2026-11-02' })).toBe(2); // Fri + Mon
  });

  it('counts a single working day as one and a single weekend day as nothing', () => {
    expect(total({ start: '2026-10-27', end: '2026-10-27' })).toBe(1);
    expect(total({ start: '2026-10-31', end: '2026-10-31' })).toBe(0);
  });

  it('skips full-day holidays', () => {
    const holidays = new Map([['2026-10-28', { halfDay: false }]]);
    expect(total({ start: '2026-10-26', end: '2026-10-30', holidays })).toBe(4);
  });

  it('counts half-day holidays as half a day', () => {
    const holidays = new Map([['2026-10-28', { halfDay: true }]]);
    expect(total({ start: '2026-10-26', end: '2026-10-30', holidays })).toBe(4.5);
  });

  it('halves the first and last day on request', () => {
    expect(total({ start: '2026-10-26', end: '2026-10-30', halfDayStart: true })).toBe(4.5);
    expect(total({ start: '2026-10-26', end: '2026-10-30', halfDayEnd: true })).toBe(4.5);
    expect(
      total({ start: '2026-10-26', end: '2026-10-30', halfDayStart: true, halfDayEnd: true }),
    ).toBe(4);
  });

  it('allows one half day, but not "from the afternoon until noon" on one day', () => {
    expect(total({ start: '2026-10-27', end: '2026-10-27', halfDayStart: true })).toBe(0.5);
    expect(total({ start: '2026-10-27', end: '2026-10-27', halfDayEnd: true })).toBe(0.5);
    expect(
      count({ start: '2026-10-27', end: '2026-10-27', halfDayStart: true, halfDayEnd: true }),
    ).toEqual({
      ok: false,
      problem: 'half_day_conflict',
    });
  });

  it('ignores a half-day flag on a day that does not count anyway', () => {
    // starts on Saturday: the "afternoon" flag has no working day to halve
    expect(total({ start: '2026-10-31', end: '2026-11-03', halfDayStart: true })).toBe(2);
    const holidays = new Map([['2026-10-26', { halfDay: false }]]);
    expect(total({ start: '2026-10-26', end: '2026-10-27', halfDayStart: true, holidays })).toBe(1);
  });

  it('never counts more than half when a half-day holiday meets a half-day flag', () => {
    const holidays = new Map([['2026-10-26', { halfDay: true }]]);
    expect(total({ start: '2026-10-26', end: '2026-10-26', halfDayStart: true, holidays })).toBe(
      0.5,
    );
  });

  it('lists the counted days with their fractions', () => {
    const result = count({ start: '2026-10-30', end: '2026-11-03', halfDayEnd: true });
    expect(result).toEqual({
      ok: true,
      total: 2.5,
      days: [
        { date: '2026-10-30', fraction: 1 },
        { date: '2026-11-02', fraction: 1 },
        { date: '2026-11-03', fraction: 0.5 },
      ],
    });
  });

  it('rejects a range that ends before it starts', () => {
    expect(count({ start: '2026-10-28', end: '2026-10-27' })).toEqual({
      ok: false,
      problem: 'end_before_start',
    });
  });

  it('accepts exactly the maximum range and rejects one day more', () => {
    const end = new Date(Date.UTC(2026, 0, 1) + (MAX_LEAVE_RANGE_DAYS - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(count({ start: '2026-01-01', end }).ok).toBe(true);
    const tooLong = new Date(Date.UTC(2026, 0, 1) + MAX_LEAVE_RANGE_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(count({ start: '2026-01-01', end: tooLong })).toEqual({
      ok: false,
      problem: 'too_long',
    });
  });

  it('counts a request over New Year', () => {
    expect(total({ start: '2026-12-28', end: '2027-01-05' })).toBe(7); // Mon-Fri, Mon-Tue
  });
});

describe('helpers', () => {
  it('sums halves exactly', () => {
    expect(sum([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])).toBe(3.5);
    expect(sum([])).toBe(0);
  });

  it('rounds to half days', () => {
    expect(roundToHalf(10.24)).toBe(10);
    expect(roundToHalf(10.25)).toBe(10.5);
    expect(roundToHalf(10.74)).toBe(10.5);
    expect(roundToHalf(10.75)).toBe(11);
  });

  it('splits days by year', () => {
    const result = count({ start: '2026-12-30', end: '2027-01-04', halfDayEnd: true });
    if (!result.ok) throw new Error('unexpected');
    expect([...daysByYear(result.days)]).toEqual([
      [2026, 2],
      [2027, 1.5],
    ]);
  });
});

describe('proratedAllowance', () => {
  it('gives the full allowance to people who joined in an earlier year or have no hire date', () => {
    expect(proratedAllowance(20, '2025-12-31', 2026)).toBe(20);
    expect(proratedAllowance(20, null, 2026)).toBe(20);
  });

  it('gives nothing for a year before the hire year', () => {
    expect(proratedAllowance(20, '2027-01-01', 2026)).toBe(0);
  });

  it('gives everything to someone starting on 1 January and about one day to someone on 31 December', () => {
    expect(proratedAllowance(20, '2026-01-01', 2026)).toBe(20);
    expect(proratedAllowance(20, '2026-12-31', 2026)).toBe(0); // 20/365 rounds to 0
  });

  it('prorates by the remaining days, in half days', () => {
    expect(proratedAllowance(20, '2026-07-02', 2026)).toBe(10); // 183 of 365 days
    expect(proratedAllowance(24, '2026-04-01', 2026)).toBe(18); // 275/365 * 24 = 18.08
    expect(proratedAllowance(0, '2026-04-01', 2026)).toBe(0);
  });

  it('knows leap years', () => {
    expect(proratedAllowance(20, '2024-07-02', 2024)).toBe(10); // 183 of 366
  });
});

describe('carryOver and remainingDays', () => {
  it('carries the unused remainder up to the cap, never a negative number', () => {
    expect(carryOver(7, 5)).toBe(5);
    expect(carryOver(3, 5)).toBe(3);
    expect(carryOver(0, 5)).toBe(0);
    expect(carryOver(-2, 5)).toBe(0);
    expect(carryOver(7, 0)).toBe(0);
    expect(carryOver(7, -3)).toBe(0);
  });

  it('computes what is left', () => {
    expect(
      remainingDays({ entitled: 20, carriedOver: 2.5, adjustment: -1, used: 7, pending: 3.5 }),
    ).toBe(11);
    expect(
      remainingDays({ entitled: 20, carriedOver: 0, adjustment: 0, used: 20, pending: 0.5 }),
    ).toBe(-0.5);
  });
});
