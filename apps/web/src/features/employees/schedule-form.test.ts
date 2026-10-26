import { workScheduleRequestSchema } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  parseDayMinutes,
  scheduleFormSchema,
  scheduleFormValues,
  toScheduleRequest,
} from './schedule-form';

const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));

describe('parseDayMinutes', () => {
  it.each([
    ['8', 480],
    ['7:30', 450],
    ['7,5', 450],
    ['7.5', 450],
    ['16', 960],
    ['16:00', 960],
    ['0', 0],
    ['0:00', 0],
    ['00', 0],
    ['', 0],
    ['   ', 0],
  ])('reads %j as %i minutes', (text, minutes) => {
    expect(parseDayMinutes(text)).toBe(minutes);
  });

  it.each(['17', '16:01', '8:60', 'abc', '-1', '1:2', '8h', '1e2'])('refuses %j', (text) => {
    expect(parseDayMinutes(text)).toBeNull();
  });
});

describe('schedule form', () => {
  const ok = scheduleFormValues('2026-11-02', [480, 480, 480, 480, 480, 0, 0]);

  it('shows an existing week the way people type it', () => {
    expect(ok.days).toEqual(['8:00', '8:00', '8:00', '8:00', '8:00', '', '']);
  });

  it('sends minutes the API accepts, with empty days as days off', () => {
    expect(scheduleFormSchema.safeParse(ok).success).toBe(true);
    const body = toScheduleRequest({ ...ok, days: ['4', '7:30', '', '0', '8', '8', ''] });
    expect(body).toEqual({ validFrom: '2026-11-02', minutes: [240, 450, 0, 0, 480, 480, 0] });
    expect(workScheduleRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['a day over 16 hours', { days: ['17', '', '', '', '', '', ''] }, ['days.0:invalidDuration']],
    ['text in a day', { days: ['', '', 'x', '', '', '', ''] }, ['days.2:invalidDuration']],
    ['a bad date', { validFrom: '2026-13-01x' }, ['validFrom:invalidDate']],
    ['an empty date', { validFrom: '' }, ['validFrom:invalidDate']],
  ])('refuses %s, as the API does', (_label, change, expected) => {
    const values = { ...ok, ...change };
    expect(issues(scheduleFormSchema.safeParse(values))).toEqual(expected);
  });

  it('refuses the wrong number of days', () => {
    expect(scheduleFormSchema.safeParse({ ...ok, days: ['8', '8'] }).success).toBe(false);
  });
});
