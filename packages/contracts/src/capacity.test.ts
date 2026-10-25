import { describe, expect, it } from 'vitest';
import {
  WORKDAY_MINUTES,
  availableMinutes,
  capacityQuerySchema,
  dayStatus,
  freeMinutes,
  loadLevel,
  plannedMinutes,
  workingMinutes,
} from './capacity.js';

describe('workingMinutes', () => {
  it('is a full day on weekdays and nothing on weekends', () => {
    expect(workingMinutes('2026-10-26')).toBe(WORKDAY_MINUTES); // Monday
    expect(workingMinutes('2026-10-30')).toBe(WORKDAY_MINUTES); // Friday
    expect(workingMinutes('2026-10-31')).toBe(0); // Saturday
    expect(workingMinutes('2026-11-01')).toBe(0); // Sunday
  });
  it('takes out holidays, half of it for a half-day holiday', () => {
    expect(workingMinutes('2026-10-27', { holiday: { halfDay: false } })).toBe(0);
    expect(workingMinutes('2026-10-27', { holiday: { halfDay: true } })).toBe(240);
  });
  it('counts only days of the employment, both end days included', () => {
    const o = { hireDate: '2026-10-27', terminationDate: '2026-10-29' };
    expect(workingMinutes('2026-10-26', o)).toBe(0);
    expect(workingMinutes('2026-10-27', o)).toBe(WORKDAY_MINUTES);
    expect(workingMinutes('2026-10-29', o)).toBe(WORKDAY_MINUTES);
    expect(workingMinutes('2026-10-30', o)).toBe(0);
    expect(workingMinutes('2026-10-30', { hireDate: null, terminationDate: null })).toBe(
      WORKDAY_MINUTES,
    );
  });
});

describe('availableMinutes and plannedMinutes', () => {
  it('takes leave out of the working time', () => {
    expect(availableMinutes(480, 0)).toBe(480);
    expect(availableMinutes(480, 0.5)).toBe(240);
    expect(availableMinutes(480, 1)).toBe(0);
    expect(availableMinutes(240, 0.5)).toBe(0); // half a day of leave on a half-day holiday
    expect(availableMinutes(0, 1)).toBe(0); // never negative
  });
  it('plans the allocation percentages of the covering assignments', () => {
    expect(plannedMinutes(480, [])).toBe(0);
    expect(plannedMinutes(480, [50])).toBe(240);
    expect(plannedMinutes(480, [50, 30])).toBe(384);
    expect(plannedMinutes(480, [60, 60])).toBe(576); // over-booked: more than available
    expect(plannedMinutes(0, [100])).toBe(0);
    expect(plannedMinutes(240, [33])).toBe(79);
    expect(plannedMinutes(100, [33, 33, 33])).toBe(99); // each part rounds on its own
  });
});

describe('loadLevel', () => {
  it.each([
    [0, 0, 'none'],
    [100, 0, 'none'],
    [0, 480, 'free'],
    [1, 480, 'busy'],
    [383, 480, 'busy'], // 79.8 %
    [384, 480, 'full'], // exactly 80 %
    [480, 480, 'full'], // exactly the available time is not over
    [481, 480, 'over'],
    [960, 480, 'over'],
  ] as const)('%i planned of %i available → %s', (planned, available, level) => {
    expect(loadLevel(planned, available)).toBe(level);
  });
});

describe('dayStatus', () => {
  const day = (o: Partial<Parameters<typeof dayStatus>[0]> = {}) =>
    dayStatus({ working: 480, leaveFraction: 0, available: 480, planned: 0, ...o });
  it('says what the day is', () => {
    expect(day()).toBe('free');
    expect(day({ planned: 100 })).toBe('busy');
    expect(day({ planned: 400 })).toBe('full');
    expect(day({ planned: 600 })).toBe('over');
  });
  it('leave and days off come first', () => {
    expect(day({ leaveFraction: 1, available: 0 })).toBe('leave');
    expect(day({ leaveFraction: 0.5, available: 240, planned: 240 })).toBe('partly_leave');
    expect(day({ working: 0, available: 0 })).toBe('off');
    expect(day({ working: 0, available: 0, leaveFraction: 1 })).toBe('leave');
    expect(day({ working: 240, leaveFraction: 0.5, available: 0 })).toBe('partly_leave');
  });
});

describe('freeMinutes', () => {
  it('is what is left, never negative', () => {
    expect(freeMinutes(480, 120)).toBe(360);
    expect(freeMinutes(480, 480)).toBe(0);
    expect(freeMinutes(480, 576)).toBe(0);
  });
});

describe('capacityQuerySchema', () => {
  const ok = { from: '2026-10-26', to: '2026-11-01' };
  it('reads a week with defaults', () => {
    expect(capacityQuerySchema.parse(ok)).toMatchObject({ page: 1, pageSize: 50 });
  });
  it.each([
    ['no start', { from: undefined }],
    ['a bad date', { to: '1.11.2026' }],
    ['an end before the start', { to: '2026-10-25' }],
    ['more than 31 days', { to: '2026-11-27' }],
    ['a bad project id', { projectId: 'x' }],
    ['a page size over 100', { pageSize: 101 }],
    ['page 0', { page: 0 }],
  ])('refuses %s', (_label, patch) => {
    expect(capacityQuerySchema.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
  it('boundaries: one day and exactly 31 days', () => {
    expect(capacityQuerySchema.safeParse({ ...ok, to: ok.from }).success).toBe(true);
    expect(capacityQuerySchema.safeParse({ ...ok, to: '2026-11-25' }).success).toBe(true); // 31 days
    expect(capacityQuerySchema.safeParse({ ...ok, to: '2026-11-26' }).success).toBe(false); // 32 days
  });
});
