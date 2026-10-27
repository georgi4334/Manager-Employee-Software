import { describe, expect, it } from 'vitest';
import {
  MAX_EVENT_TITLE,
  createEventRequestSchema,
  eventQuerySchema,
  eventShapeIssues,
  eventReminderDue,
  respondRequestSchema,
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

describe('recurrence and guests on events (ADR 0028)', () => {
  const base = {
    scope: 'personal',
    title: 'Standup',
    allDay: false,
    startDate: '2026-10-27',
    endDate: '2026-10-27',
    startTime: '09:00',
    endTime: '09:15',
  };

  it('accepts a repeating personal event with guests', () => {
    const parsed = createEventRequestSchema.safeParse({
      ...base,
      recurrence: { freq: 'weekly', weekdays: [1, 3], count: 10 },
      attendeeIds: [ID],
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses guests on team and company events', () => {
    for (const scope of ['team', 'company'] as const) {
      const r = createEventRequestSchema.safeParse({
        ...base,
        scope,
        ...(scope === 'team' ? { teamId: ID } : {}),
        attendeeIds: [ID],
      });
      expect(r.success, scope).toBe(false);
    }
  });

  it('accepts an empty guest list on any scope', () => {
    expect(
      createEventRequestSchema.safeParse({ ...base, scope: 'company', attendeeIds: [] }).success,
    ).toBe(true);
  });

  it('refuses duplicate guests, too many guests and a repeat that ends before the start', () => {
    expect(createEventRequestSchema.safeParse({ ...base, attendeeIds: [ID, ID] }).success).toBe(
      false,
    );
    const many = Array.from(
      { length: 51 },
      (_, i) => `0192f5a0-0000-7000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(createEventRequestSchema.safeParse({ ...base, attendeeIds: many }).success).toBe(false);
    expect(
      createEventRequestSchema.safeParse({
        ...base,
        recurrence: { freq: 'daily', until: '2026-10-26' },
      }).success,
    ).toBe(false);
    expect(
      createEventRequestSchema.safeParse({
        ...base,
        recurrence: { freq: 'daily', until: '2026-10-27' },
      }).success,
    ).toBe(true);
  });

  it('lets an update remove the repeat with null and replace the guest list', () => {
    expect(updateEventRequestSchema.safeParse({ recurrence: null }).success).toBe(true);
    expect(updateEventRequestSchema.safeParse({ attendeeIds: [] }).success).toBe(true);
    expect(updateEventRequestSchema.safeParse({ attendeeIds: [ID, ID] }).success).toBe(false);
    expect(
      updateEventRequestSchema.safeParse({ recurrence: { freq: 'monthly', interval: 2 } }).success,
    ).toBe(true);
  });

  it('accepts only three answers', () => {
    for (const response of ['accepted', 'declined', 'tentative']) {
      expect(respondRequestSchema.safeParse({ response }).success).toBe(true);
    }
    for (const response of ['needs_action', 'yes', '']) {
      expect(respondRequestSchema.safeParse({ response }).success).toBe(false);
    }
    expect(respondRequestSchema.safeParse({}).success).toBe(false);
    expect(respondRequestSchema.safeParse({ response: 'accepted', extra: 1 }).success).toBe(false);
  });

  describe('reminders', () => {
    it('accepts one hour or one day on personal and team events', () => {
      for (const reminderMinutes of [60, 1440]) {
        expect(createEventRequestSchema.safeParse({ ...timed, reminderMinutes }).success).toBe(
          true,
        );
      }
      expect(
        createEventRequestSchema.safeParse({
          ...timed,
          scope: 'team',
          teamId: ID,
          reminderMinutes: 60,
        }).success,
      ).toBe(true);
    });

    it.each([0, 5, 30, 61, -60, 1.5, '60', null])(
      'refuses %s minutes on create',
      (reminderMinutes) => {
        expect(createEventRequestSchema.safeParse({ ...timed, reminderMinutes }).success).toBe(
          false,
        );
      },
    );

    it('refuses a reminder on a company event', () => {
      const res = createEventRequestSchema.safeParse({ ...allDay, reminderMinutes: 60 });
      expect(res.success).toBe(false);
      expect(res.error?.issues[0]).toMatchObject({
        path: ['reminderMinutes'],
        message: 'reminder_not_allowed',
      });
    });

    it('lets an update set or remove the reminder', () => {
      expect(updateEventRequestSchema.safeParse({ reminderMinutes: 1440 }).success).toBe(true);
      expect(updateEventRequestSchema.safeParse({ reminderMinutes: null }).success).toBe(true);
      expect(updateEventRequestSchema.safeParse({ reminderMinutes: 15 }).success).toBe(false);
    });

    it('is due from the lead until the start, and never after it', () => {
      const start = Date.UTC(2026, 10, 3, 9, 0);
      const min = 60_000;
      expect(eventReminderDue(start, 60, start - 61 * min)).toBe(false);
      expect(eventReminderDue(start, 60, start - 60 * min)).toBe(true);
      expect(eventReminderDue(start, 60, start - 1)).toBe(true);
      expect(eventReminderDue(start, 60, start)).toBe(false);
      expect(eventReminderDue(start, 60, start + min)).toBe(false);
      expect(eventReminderDue(start, 1440, start - 1440 * min)).toBe(true);
      expect(eventReminderDue(start, 1440, start - 1441 * min)).toBe(false);
    });
  });
});
