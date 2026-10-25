import { describe, expect, it } from 'vitest';
import {
  createTimeEntryRequestSchema,
  formatDuration,
  isLockedStatus,
  isWeekStart,
  parseDuration,
  startTimerRequestSchema,
  timerMinutes,
  timesheetQuerySchema,
  updateTimeEntryRequestSchema,
  weekDays,
  weekStartOf,
} from './time.js';

const ID = '0192f5a0-0000-7000-8000-00000000000a';

describe('weeks', () => {
  it('starts on Monday, whatever day it is', () => {
    expect(weekStartOf('2026-10-26')).toBe('2026-10-26'); // Monday
    expect(weekStartOf('2026-10-28')).toBe('2026-10-26');
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26'); // Sunday belongs to the week before
    expect(weekStartOf('2026-11-02')).toBe('2026-11-02');
  });
  it('crosses month and year ends', () => {
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
    expect(weekDays('2026-12-28')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });
  it('knows a Monday', () => {
    expect(isWeekStart('2026-10-26')).toBe(true);
    expect(isWeekStart('2026-10-27')).toBe(false);
  });
});

describe('locking', () => {
  it.each([
    ['submitted', true],
    ['approved', true],
    ['rejected', false],
    ['open', false],
    [null, false],
    [undefined, false],
  ] as const)('%s → locked: %s', (status, locked) => {
    expect(isLockedStatus(status)).toBe(locked);
  });
});

describe('timerMinutes', () => {
  const at = (iso: string) => new Date(iso);
  it('rounds up to whole minutes, at least one', () => {
    expect(timerMinutes(at('2026-10-26T08:00:00Z'), at('2026-10-26T08:00:00Z')).minutes).toBe(1);
    expect(timerMinutes(at('2026-10-26T08:00:00Z'), at('2026-10-26T08:00:01Z')).minutes).toBe(1);
    expect(timerMinutes(at('2026-10-26T08:00:00Z'), at('2026-10-26T08:01:00Z')).minutes).toBe(1);
    expect(timerMinutes(at('2026-10-26T08:00:00Z'), at('2026-10-26T08:01:01Z')).minutes).toBe(2);
    expect(timerMinutes(at('2026-10-26T08:00:00Z'), at('2026-10-26T09:30:00Z')).minutes).toBe(90);
  });
  it('caps a forgotten timer at 16 hours and says so', () => {
    expect(timerMinutes(at('2026-10-26T08:00:00Z'), at('2026-10-27T00:00:00Z'))).toEqual({
      minutes: 960,
      capped: false,
    });
    expect(timerMinutes(at('2026-10-26T08:00:00Z'), at('2026-10-27T00:01:00Z'))).toEqual({
      minutes: 960,
      capped: true,
    });
  });
  it('never goes below one minute if the clock went backwards', () => {
    expect(timerMinutes(at('2026-10-26T08:05:00Z'), at('2026-10-26T08:00:00Z')).minutes).toBe(1);
  });
});

describe('durations', () => {
  it.each([
    ['1:30', 90],
    ['0:01', 1],
    ['16:00', 960],
    ['01:05', 65],
    ['1.5', 90],
    ['1,5', 90],
    ['0.25', 15],
    ['8', 480],
    [' 2 ', 120],
  ])('reads %s as %i minutes', (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });
  it.each(['', 'abc', '0', '0:00', '16:01', '17', '1:60', '1:5', '-1', '1.555', '1h', '1:30:00'])(
    'refuses %j',
    (text) => {
      expect(parseDuration(text)).toBeNull();
    },
  );
  it('formats as hours:minutes and parses back', () => {
    expect(formatDuration(90)).toBe('1:30');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(-3)).toBe('0:00');
    for (const m of [1, 59, 60, 61, 480, 960]) expect(parseDuration(formatDuration(m))).toBe(m);
  });
});

describe('request schemas', () => {
  const entry = { projectId: ID, workDate: '2026-10-26', minutes: 90 };
  it('accepts a manual entry and trims the note, dropping an empty one', () => {
    expect(createTimeEntryRequestSchema.parse({ ...entry, note: '  x ' }).note).toBe('x');
    expect(createTimeEntryRequestSchema.parse({ ...entry, note: '  ' }).note).toBeUndefined();
  });
  it.each([
    ['no project', { projectId: undefined }],
    ['a bad project id', { projectId: 'x' }],
    ['no minutes', { minutes: undefined }],
    ['zero minutes', { minutes: 0 }],
    ['over 16 hours', { minutes: 961 }],
    ['fractions', { minutes: 1.5 }],
    ['a bad date', { workDate: '26.10.2026' }],
    ['a long note', { note: 'x'.repeat(501) }],
    ['an unknown key', { extra: 1 }],
  ])('refuses %s', (_label, patch) => {
    expect(createTimeEntryRequestSchema.safeParse({ ...entry, ...patch }).success).toBe(false);
  });
  it('boundaries: 1 minute and 16 hours', () => {
    for (const minutes of [1, 960]) {
      expect(createTimeEntryRequestSchema.safeParse({ ...entry, minutes }).success).toBe(true);
    }
  });
  it('starts a timer with the project only', () => {
    expect(startTimerRequestSchema.safeParse({ projectId: ID }).success).toBe(true);
    expect(startTimerRequestSchema.safeParse({}).success).toBe(false);
    expect(startTimerRequestSchema.safeParse({ projectId: ID, minutes: 5 }).success).toBe(false);
  });
  it('updates partly, clears with null, and needs something to change', () => {
    expect(updateTimeEntryRequestSchema.safeParse({ taskId: null, note: null }).success).toBe(true);
    expect(updateTimeEntryRequestSchema.parse({ note: '' }).note).toBeNull();
    expect(updateTimeEntryRequestSchema.safeParse({}).success).toBe(false);
    expect(updateTimeEntryRequestSchema.safeParse({ minutes: 0 }).success).toBe(false);
  });
  it('lists submitted sheets by default and refuses odd statuses', () => {
    expect(timesheetQuerySchema.parse({}).status).toBe('submitted');
    expect(timesheetQuerySchema.safeParse({ status: 'locked' }).success).toBe(false);
    expect(timesheetQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });
});
