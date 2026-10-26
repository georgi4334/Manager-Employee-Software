import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEEK,
  scheduleFor,
  scheduleIndex,
  scheduledMinutes,
  weekMinutes,
  workScheduleRequestSchema,
} from './schedule.js';

const part = { validFrom: '2026-03-02', minutes: [240, 240, 240, 240, 240, 0, 0] };
const full = { validFrom: '2026-09-07', minutes: [480, 480, 480, 480, 480, 0, 0] };
const saturday = { validFrom: '2026-11-02', minutes: [480, 480, 480, 480, 0, 480, 0] };

describe('scheduleIndex', () => {
  it('is Monday first', () => {
    expect(scheduleIndex('2026-10-26')).toBe(0); // Monday
    expect(scheduleIndex('2026-10-30')).toBe(4); // Friday
    expect(scheduleIndex('2026-10-31')).toBe(5); // Saturday
    expect(scheduleIndex('2026-11-01')).toBe(6); // Sunday
  });
});

describe('scheduleFor / scheduledMinutes', () => {
  const all = [full, part, saturday]; // deliberately unsorted

  it('picks the latest schedule on or before the date', () => {
    expect(scheduleFor(all, '2026-03-02')).toBe(part); // the first day counts
    expect(scheduleFor(all, '2026-09-06')).toBe(part);
    expect(scheduleFor(all, '2026-09-07')).toBe(full);
    expect(scheduleFor(all, '2026-11-02')).toBe(saturday);
    expect(scheduleFor(all, '2027-01-01')).toBe(saturday);
  });

  it('knows nothing before the first schedule and falls back to the default week', () => {
    expect(scheduleFor(all, '2026-03-01')).toBeNull();
    expect(scheduledMinutes(all, '2026-03-01')).toBe(0); // a Sunday: the default week is off
  });

  it('returns the contractual minutes of the weekday', () => {
    expect(scheduledMinutes([part], '2026-10-26')).toBe(240);
    expect(scheduledMinutes([part], '2026-10-31')).toBe(0);
    expect(scheduledMinutes(all, '2026-11-07')).toBe(480); // a Saturday that is now a working day
    expect(scheduledMinutes(all, '2026-11-06')).toBe(0); // and the Friday that is now off
  });

  it('is the default week without any schedule', () => {
    expect(scheduledMinutes([], '2026-10-26')).toBe(480);
    expect(scheduledMinutes([], '2026-10-31')).toBe(0);
    expect(weekMinutes(DEFAULT_WEEK)).toBe(2400);
  });
});

describe('workScheduleRequestSchema', () => {
  const ok = { validFrom: '2026-11-02', minutes: [480, 480, 480, 480, 480, 0, 0] };

  it('accepts a week, including long and empty days', () => {
    expect(workScheduleRequestSchema.safeParse(ok).success).toBe(true);
    expect(
      workScheduleRequestSchema.safeParse({ ...ok, minutes: [960, 0, 0, 0, 0, 0, 960] }).success,
    ).toBe(true);
    expect(
      workScheduleRequestSchema.safeParse({ ...ok, minutes: [0, 0, 0, 0, 0, 0, 0] }).success,
    ).toBe(true);
  });

  it.each([
    ['six days', { minutes: [480, 480, 480, 480, 480, 0] }],
    ['eight days', { minutes: [480, 480, 480, 480, 480, 0, 0, 0] }],
    ['a negative day', { minutes: [-1, 480, 480, 480, 480, 0, 0] }],
    ['more than 16 hours', { minutes: [961, 480, 480, 480, 480, 0, 0] }],
    ['a fraction of a minute', { minutes: [480.5, 480, 480, 480, 480, 0, 0] }],
    ['a bad date', { validFrom: '2026-13-01' }],
    ['an unknown field', { extra: 1 }],
  ])('refuses %s', (_name, change) => {
    expect(workScheduleRequestSchema.safeParse({ ...ok, ...change }).success).toBe(false);
  });
});
