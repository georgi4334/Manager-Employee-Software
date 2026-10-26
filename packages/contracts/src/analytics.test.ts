import { describe, expect, it } from 'vitest';
import {
  MIN_GROUP_SIZE,
  analyticsQuerySchema,
  bucketByWeek,
  percentOf,
  suppressSmallGroup,
  weekStarts,
} from './analytics.js';

describe('analyticsQuerySchema', () => {
  const ok = { from: '2026-10-01', to: '2026-10-31' };
  it('accepts a normal period and a single day', () => {
    expect(analyticsQuerySchema.safeParse(ok).success).toBe(true);
    expect(analyticsQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-01' }).success).toBe(
      true,
    );
  });
  it('accepts 366 days and refuses 367', () => {
    expect(analyticsQuerySchema.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success).toBe(
      true,
    );
    expect(analyticsQuerySchema.safeParse({ from: '2026-01-01', to: '2027-01-02' }).success).toBe(
      false,
    );
  });
  it('refuses an end before the start, bad dates and missing fields', () => {
    expect(analyticsQuerySchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success).toBe(
      false,
    );
    expect(analyticsQuerySchema.safeParse({ from: '2026-13-01', to: '2026-10-01' }).success).toBe(
      false,
    );
    expect(analyticsQuerySchema.safeParse({ from: '2026-10-01' }).success).toBe(false);
  });
});

describe('suppressSmallGroup', () => {
  it('withholds below the minimum and shows at it', () => {
    expect(suppressSmallGroup(MIN_GROUP_SIZE - 1, [1])).toBeNull();
    expect(suppressSmallGroup(0, [1])).toBeNull();
    expect(suppressSmallGroup(MIN_GROUP_SIZE, [1])).toEqual([1]);
  });
});

describe('percentOf', () => {
  it('rounds and refuses to divide by nothing', () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(0, 5)).toBe(0);
    expect(percentOf(5, 0)).toBeNull();
  });
});

describe('weekStarts / bucketByWeek', () => {
  it('lists the Mondays the period touches', () => {
    // 2026-10-26 is a Monday.
    expect(weekStarts('2026-10-28', '2026-11-03')).toEqual(['2026-10-26', '2026-11-02']);
    expect(weekStarts('2026-10-26', '2026-10-26')).toEqual(['2026-10-26']);
    expect(weekStarts('2026-10-27', '2026-10-26')).toEqual([]);
  });
  it('sums minutes per week, keeps empty weeks and ignores entries outside the period', () => {
    const result = bucketByWeek('2026-10-26', '2026-11-15', [
      { date: '2026-10-26', minutes: 60 },
      { date: '2026-11-01', minutes: 30 },
      { date: '2026-11-09', minutes: 45 },
      { date: '2026-10-25', minutes: 999 },
      { date: '2026-11-16', minutes: 999 },
    ]);
    expect(result).toEqual([
      { weekStart: '2026-10-26', minutes: 90 },
      { weekStart: '2026-11-02', minutes: 0 },
      { weekStart: '2026-11-09', minutes: 45 },
    ]);
  });
  it('is empty for an inverted period', () => {
    expect(bucketByWeek('2026-11-01', '2026-10-01', [{ date: '2026-10-05', minutes: 5 }])).toEqual(
      [],
    );
  });
});
