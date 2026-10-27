import { describe, expect, it } from 'vitest';
import {
  FIND_TIME_MAX_PEOPLE,
  findSlots,
  findTimeRequestSchema,
  minutesToTime,
  overlapsAny,
} from './find-time.js';

const free = { available: true, busy: [] };
const ID = '0192f5a0-0000-7000-8000-00000000000a';
const ID2 = '0192f5a0-0000-7000-8000-00000000000b';

describe('overlapsAny', () => {
  it('treats the end as exclusive', () => {
    expect(overlapsAny([{ start: 600, end: 660 }], 660, 720)).toBe(false);
    expect(overlapsAny([{ start: 600, end: 660 }], 540, 600)).toBe(false);
    expect(overlapsAny([{ start: 600, end: 660 }], 630, 690)).toBe(true);
    expect(overlapsAny([], 0, 1440)).toBe(false);
  });
});

describe('findSlots', () => {
  it('starts at the beginning of the window on a free day, on the 30-minute grid', () => {
    const slots = findSlots([{ date: '2026-10-27', people: [free, free] }], 60, { limit: 3 });
    expect(slots).toEqual([
      { date: '2026-10-27', start: 540, end: 600 },
      { date: '2026-10-27', start: 570, end: 630 },
      { date: '2026-10-27', start: 600, end: 660 },
    ]);
  });

  it('skips time when anybody is busy, using every person’s busy intervals', () => {
    const day = {
      date: '2026-10-27',
      people: [
        { available: true, busy: [{ start: 540, end: 600 }] },
        { available: true, busy: [{ start: 600, end: 690 }] },
      ],
    };
    const [first] = findSlots([day], 60);
    expect(first).toEqual({ date: '2026-10-27', start: 690, end: 750 });
  });

  it('skips a whole day when one person is not available', () => {
    const slots = findSlots(
      [
        { date: '2026-10-27', people: [free, { available: false, busy: [] }] },
        { date: '2026-10-28', people: [free, free] },
      ],
      30,
      { limit: 1 },
    );
    expect(slots).toEqual([{ date: '2026-10-28', start: 540, end: 570 }]);
  });

  it('fits a slot exactly at the end of the window and not beyond it', () => {
    const day = {
      date: '2026-10-27',
      people: [{ available: true, busy: [{ start: 540, end: 1020 }] }],
    };
    expect(findSlots([day], 60)).toEqual([{ date: '2026-10-27', start: 1020, end: 1080 }]);
    expect(findSlots([day], 90)).toEqual([]);
  });

  it('returns nothing for no people, no days or an impossible duration', () => {
    expect(findSlots([{ date: '2026-10-27', people: [] }], 30)).toEqual([]);
    expect(findSlots([], 30)).toEqual([]);
    expect(findSlots([{ date: '2026-10-27', people: [free] }], 600)).toEqual([]);
    expect(findSlots([{ date: '2026-10-27', people: [free] }], 0)).toEqual([]);
  });

  it('stops at the limit and keeps the days in order', () => {
    const days = ['2026-10-27', '2026-10-28'].map((date) => ({ date, people: [free] }));
    const slots = findSlots(days, 480, { limit: 10 });
    expect(slots.map((s) => [s.date, s.start])).toEqual([
      ['2026-10-27', 540],
      ['2026-10-27', 570],
      ['2026-10-27', 600],
      ['2026-10-28', 540],
      ['2026-10-28', 570],
      ['2026-10-28', 600],
    ]);
    expect(findSlots(days, 30, { limit: 4 })).toHaveLength(4);
  });
});

describe('minutesToTime', () => {
  it('formats minutes since midnight', () => {
    expect(minutesToTime(540)).toBe('09:00');
    expect(minutesToTime(1075)).toBe('17:55');
    expect(minutesToTime(0)).toBe('00:00');
  });
});

describe('findTimeRequestSchema', () => {
  const ok = { employeeIds: [ID], from: '2026-10-27', to: '2026-10-30', durationMinutes: 60 };

  it('accepts a request, one day and 14 days', () => {
    expect(findTimeRequestSchema.safeParse(ok).success).toBe(true);
    expect(findTimeRequestSchema.safeParse({ ...ok, to: ok.from }).success).toBe(true);
    expect(
      findTimeRequestSchema.safeParse({ ...ok, from: '2026-10-01', to: '2026-10-14' }).success,
    ).toBe(true);
  });

  it.each([
    ['no people', { employeeIds: [] }],
    [
      'too many people',
      {
        employeeIds: Array.from(
          { length: FIND_TIME_MAX_PEOPLE + 1 },
          (_, i) => `0192f5a0-0000-7000-8000-${String(i).padStart(12, '0')}`,
        ),
      },
    ],
    ['a duplicate person', { employeeIds: [ID, ID] }],
    ['a bad id', { employeeIds: ['nope'] }],
    ['more than 14 days', { from: '2026-10-01', to: '2026-10-15' }],
    ['an inverted period', { from: '2026-10-30', to: '2026-10-27' }],
    ['under 15 minutes', { durationMinutes: 14 }],
    ['over 8 hours', { durationMinutes: 481 }],
    ['half minutes', { durationMinutes: 30.5 }],
    ['an unknown field', { extra: 1 }],
  ])('refuses %s', (_name, change) => {
    expect(findTimeRequestSchema.safeParse({ ...ok, ...change }).success).toBe(false);
  });

  it('accepts two different people and the duration limits', () => {
    expect(
      findTimeRequestSchema.safeParse({ ...ok, employeeIds: [ID, ID2], durationMinutes: 15 })
        .success,
    ).toBe(true);
    expect(findTimeRequestSchema.safeParse({ ...ok, durationMinutes: 480 }).success).toBe(true);
  });
});
