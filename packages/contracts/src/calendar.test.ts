import { describe, expect, it } from 'vitest';
import {
  MAX_EVENT_TITLE,
  createEventRequestSchema,
  eventQuerySchema,
  eventShapeIssues,
  updateEventRequestSchema,
} from './calendar.js';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const timed = {
  scope: 'personal' as const,
  title: 'Dentist',
  allDay: false,
  startDate: '2026-11-03',
  endDate: '2026-11-03',
  startTime: '09:00',
  endTime: '10:00',
};
const allDay = {
  scope: 'company' as const,
  title: 'Party',
  allDay: true,
  startDate: '2026-12-18',
  endDate: '2026-12-18',
};
const bad = (body: object) => createEventRequestSchema.safeParse(body).success;

describe('creating an event', () => {
  it('accepts timed, all-day and team events and trims text', () => {
    expect(
      createEventRequestSchema.parse({
        ...timed,
        title: '  Dentist ',
        location: ' ',
        description: ' x ',
      }),
    ).toMatchObject({
      title: 'Dentist',
      location: undefined,
      description: 'x',
    });
    expect(bad(allDay)).toBe(true);
    expect(bad({ ...timed, scope: 'team', teamId: ID })).toBe(true);
    expect(bad({ ...timed, endDate: '2026-11-05', endTime: '08:00' })).toBe(true); // ends on a later day
    expect(bad({ ...allDay, endDate: '2027-01-17' })).toBe(true); // exactly 31 days
  });

  it.each([
    ['no title', { title: '  ' }],
    ['a long title', { title: 'x'.repeat(MAX_EVENT_TITLE + 1) }],
    ['an unknown scope', { scope: 'public' }],
    ['a team event without a team', { scope: 'team' }],
    ['a team on a personal event', { teamId: ID }],
    ['a time on an all-day event', { ...allDay, startTime: '09:00' }],
    ['a timed event without times', { startTime: undefined, endTime: undefined }],
    ['an end before the start', { startTime: '10:00', endTime: '09:00' }],
    ['an end equal to the start', { endTime: '09:00' }],
    ['an end date before the start date', { endDate: '2026-11-02' }],
    ['more than 31 days', { ...allDay, endDate: '2027-01-18' }],
    ['a bad time', { startTime: '9am' }],
    ['a bad date', { startDate: '3.11.2026' }],
    ['extra fields (owner)', { ownerEmployeeId: ID }],
  ])('refuses %s', (_label, patch) => {
    expect(bad({ ...timed, ...patch })).toBe(false);
  });
});

describe('shape rules', () => {
  it('names the broken field and rule', () => {
    expect(eventShapeIssues({ ...timed, endTime: '08:00' })).toEqual([
      { path: 'endTime', code: 'end_before_start' },
    ]);
    expect(eventShapeIssues({ ...allDay, startTime: '09:00' })).toEqual([
      { path: 'startTime', code: 'time_not_allowed' },
    ]);
    expect(eventShapeIssues({ ...timed, scope: 'team' })).toEqual([
      { path: 'teamId', code: 'required' },
    ]);
    expect(eventShapeIssues(timed)).toEqual([]);
  });
});

describe('updating an event', () => {
  it('allows partial changes and clearing text', () => {
    expect(updateEventRequestSchema.parse({ location: ' ' })).toEqual({ location: null });
    expect(
      updateEventRequestSchema.parse({ allDay: true, startTime: null, endTime: null }),
    ).toEqual({
      allDay: true,
      startTime: null,
      endTime: null,
    });
  });
  it.each([[{}], [{ scope: 'company' }], [{ teamId: ID }], [{ title: '' }], [{ startDate: 'x' }]])(
    'refuses %j',
    (body) => {
      expect(updateEventRequestSchema.safeParse(body).success).toBe(false);
    },
  );
});

describe('listing events', () => {
  it('needs an ordered period of at most 93 days', () => {
    expect(eventQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-30' }).success).toBe(true);
    expect(eventQuerySchema.safeParse({ from: '2026-11-01', to: '2027-02-01' }).success).toBe(true); // 93 days
    expect(eventQuerySchema.safeParse({ from: '2026-11-01', to: '2027-02-02' }).success).toBe(
      false,
    );
    expect(eventQuerySchema.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success).toBe(
      false,
    );
    expect(eventQuerySchema.safeParse({ from: '2026-11-01' }).success).toBe(false);
  });
});
