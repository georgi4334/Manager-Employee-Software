import { createEventRequestSchema, updateEventRequestSchema } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  emptyEvent,
  eventFormSchema,
  toCreateRequest,
  toUpdateRequest,
  type EventFormValues,
} from './forms';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));

const base: EventFormValues = {
  ...emptyEvent('2026-11-03'),
  title: ' Dentist ',
  startTime: '09:00',
  endTime: '10:30',
  location: ' Clinic ',
};

describe('event form', () => {
  it('accepts valid events and maps to what the API accepts', () => {
    expect(eventFormSchema.safeParse(base).success).toBe(true);
    const body = toCreateRequest(base);
    expect(body).toMatchObject({ title: 'Dentist', location: 'Clinic', startTime: '09:00' });
    expect(body).not.toHaveProperty('description');
    expect(body).not.toHaveProperty('teamId');
    expect(createEventRequestSchema.safeParse(body).success).toBe(true);
    expect(updateEventRequestSchema.safeParse(toUpdateRequest(base)).success).toBe(true);
  });

  it('sends no times for all-day events, even when the fields still hold some', () => {
    const allDay = { ...base, allDay: true, endDate: '2026-11-05' };
    expect(eventFormSchema.safeParse(allDay).success).toBe(true);
    const body = toCreateRequest(allDay);
    expect(body).not.toHaveProperty('startTime');
    expect(createEventRequestSchema.safeParse(body).success).toBe(true);
    expect(toUpdateRequest(allDay)).toMatchObject({ allDay: true, startTime: null, endTime: null });
  });

  it('sends the team only for team events, and clears emptied text on update', () => {
    const team = { ...base, scope: 'team' as const, teamId: ID };
    expect(toCreateRequest(team)).toMatchObject({ scope: 'team', teamId: ID });
    expect(createEventRequestSchema.safeParse(toCreateRequest(team)).success).toBe(true);
    expect(toUpdateRequest({ ...base, location: ' ' }).location).toBeNull();
  });

  it.each([
    ['no title', { title: ' ' }, ['title:required']],
    ['a long title', { title: 'x'.repeat(121) }, ['title:tooLong']],
    ['missing times', { startTime: '', endTime: '' }, ['startTime:required', 'endTime:required']],
    ['a bad time', { startTime: '9am' }, ['startTime:invalidTime']],
    [
      'an end before the start',
      { startTime: '10:00', endTime: '09:00' },
      ['endTime:end_before_start'],
    ],
    ['an end date before the start date', { endDate: '2026-11-02' }, ['endDate:end_before_start']],
    ['a bad date', { startDate: '3.11.2026' }, ['startDate:invalidDate']],
    ['an empty date', { endDate: '' }, ['endDate:required']],
    ['more than 31 days', { allDay: true, endDate: '2026-12-10' }, ['endDate:too_long']],
    ['a team event without a team', { scope: 'team' as const }, ['teamId:required']],
  ])('refuses %s, as the API does', (_label, patch, expected) => {
    const values: EventFormValues = { ...base, ...patch };
    expect(issues(eventFormSchema.safeParse(values))).toEqual(expected);
    expect(createEventRequestSchema.safeParse(toCreateRequest(values)).success).toBe(false);
  });
});
