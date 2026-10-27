import {
  createEventRequestSchema,
  recurrenceRequestSchema,
  updateEventRequestSchema,
  type CalendarEvent,
} from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  emptyEvent,
  eventFormSchema,
  toCreateRequest,
  toUpdateRequest,
  valuesOf,
  type EventFormValues,
} from './forms';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));

const stored = (o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: ID,
  scope: 'personal',
  team: null,
  owner: { id: ID, firstName: 'Maria', lastName: 'Ivanova' },
  title: 'Dentist',
  description: null,
  location: null,
  allDay: false,
  startDate: '2026-11-03',
  endDate: '2026-11-03',
  startTime: '09:00',
  endTime: '10:30',
  canEdit: true,
  recurrence: null,
  occurrenceDate: '2026-11-03',
  isOrganizer: true,
  attendees: [],
  myResponse: null,
  ...o,
});

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
    expect(updateEventRequestSchema.safeParse(toUpdateRequest(base, stored())).success).toBe(true);
  });

  it('sends no times for all-day events, even when the fields still hold some', () => {
    const allDay = { ...base, allDay: true, endDate: '2026-11-05' };
    expect(eventFormSchema.safeParse(allDay).success).toBe(true);
    const body = toCreateRequest(allDay);
    expect(body).not.toHaveProperty('startTime');
    expect(createEventRequestSchema.safeParse(body).success).toBe(true);
    expect(toUpdateRequest(allDay, stored())).toMatchObject({
      allDay: true,
      startTime: null,
      endTime: null,
    });
  });

  it('sends the team only for team events, and clears emptied text on update', () => {
    const team = { ...base, scope: 'team' as const, teamId: ID };
    expect(toCreateRequest(team)).toMatchObject({ scope: 'team', teamId: ID });
    expect(createEventRequestSchema.safeParse(toCreateRequest(team)).success).toBe(true);
    expect(toUpdateRequest({ ...base, location: ' ' }, stored()).location).toBeNull();
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

  describe('repeating and guests', () => {
    const weekly: EventFormValues = {
      ...base,
      repeat: 'weekly',
      interval: '2',
      weekdays: [2, 0],
      ends: 'count',
      count: '6',
    };
    const GUEST = '0192f5a0-0000-7000-8000-00000000000b';

    it('maps the repeat rule and the guests to what the API accepts', () => {
      expect(eventFormSchema.safeParse(weekly).success).toBe(true);
      const body = toCreateRequest({ ...weekly, attendeeIds: [GUEST] });
      expect(body).toMatchObject({
        recurrence: { freq: 'weekly', interval: 2, weekdays: [0, 2], until: null, count: 6 },
        attendeeIds: [GUEST],
      });
      expect(createEventRequestSchema.safeParse(body).success).toBe(true);
      expect(recurrenceRequestSchema.safeParse(body.recurrence).success).toBe(true);
    });

    it('sends neither a rule nor guests when there are none, and no guests outside personal events', () => {
      const body = toCreateRequest(base);
      expect(body).not.toHaveProperty('recurrence');
      expect(body).not.toHaveProperty('attendeeIds');
      const team = toCreateRequest({ ...base, scope: 'team', teamId: ID, attendeeIds: [GUEST] });
      expect(team).not.toHaveProperty('attendeeIds');
    });

    it('drops weekdays for other frequencies and the end that was not chosen', () => {
      const daily = toCreateRequest({
        ...weekly,
        repeat: 'daily',
        ends: 'until',
        until: '2026-12-01',
        count: '6',
      });
      expect(daily.recurrence).toEqual({
        freq: 'daily',
        interval: 2,
        weekdays: [],
        until: '2026-12-01',
        count: null,
      });
    });

    it('round-trips a stored series through the form', () => {
      const event = stored({
        recurrence: {
          freq: 'weekly',
          interval: 1,
          weekdays: [1, 3],
          until: '2027-01-01',
          count: null,
        },
        attendees: [
          { employee: { id: GUEST, firstName: 'Dan', lastName: 'D' }, response: 'accepted' },
        ],
      });
      const values = valuesOf(event);
      expect(values).toMatchObject({ repeat: 'weekly', ends: 'until', until: '2027-01-01' });
      expect(values.attendeeIds).toEqual([GUEST]);
      // nothing changed, so nothing about the rule or guests goes to the server
      const body = toUpdateRequest(values, event);
      expect(body).not.toHaveProperty('recurrence');
      expect(body).not.toHaveProperty('attendeeIds');
      expect(updateEventRequestSchema.safeParse(body).success).toBe(true);
    });

    it('sends the changed rule or guest list, and null to stop repeating', () => {
      const event = stored({
        recurrence: { freq: 'daily', interval: 1, weekdays: [], until: null, count: null },
      });
      const stop = toUpdateRequest({ ...valuesOf(event), repeat: 'none' }, event);
      expect(stop.recurrence).toBeNull();
      const guests = toUpdateRequest({ ...valuesOf(event), attendeeIds: [GUEST] }, event);
      expect(guests.attendeeIds).toEqual([GUEST]);
      expect(updateEventRequestSchema.safeParse(guests).success).toBe(true);
    });

    it('never sends the rule when one occurrence is edited, nor guests unless organizer', () => {
      const event = stored({
        isOrganizer: false,
        recurrence: { freq: 'daily', interval: 1, weekdays: [], until: null, count: null },
      });
      const values = { ...valuesOf(event), repeat: 'weekly' as const, attendeeIds: [GUEST] };
      const body = toUpdateRequest(values, event, 'this');
      expect(body).not.toHaveProperty('recurrence');
      expect(body).not.toHaveProperty('attendeeIds');
    });

    it.each([
      ['an interval of 0', { interval: '0' }, ['interval:invalidInterval']],
      ['an interval over 30', { interval: '31' }, ['interval:invalidInterval']],
      ['a text interval', { interval: 'x' }, ['interval:invalidInterval']],
      ['a count of 0', { count: '0' }, ['count:invalidCount']],
      ['a count over 500', { count: '501' }, ['count:invalidCount']],
      ['no end date', { ends: 'until' as const, until: '' }, ['until:required']],
      [
        'an end before the start',
        { ends: 'until' as const, until: '2026-11-02' },
        ['until:end_before_start'],
      ],
    ])('refuses %s, as the API does', (_label, patch, expected) => {
      const values: EventFormValues = { ...weekly, ...patch };
      expect(issues(eventFormSchema.safeParse(values))).toEqual(expected);
      expect(createEventRequestSchema.safeParse(toCreateRequest(values)).success).toBe(false);
    });

    it('ignores the repeat fields while the event does not repeat, and refuses too many guests', () => {
      expect(eventFormSchema.safeParse({ ...base, interval: 'x', count: 'y' }).success).toBe(true);
      const many = Array.from({ length: 51 }, (_, i) => `id-${i}`);
      expect(issues(eventFormSchema.safeParse({ ...base, attendeeIds: many }))).toEqual([
        'attendeeIds:tooMany',
      ]);
    });
  });
});
