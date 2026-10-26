import {
  createActionItemRequestSchema,
  createOneOnOneRequestSchema,
  updateOneOnOneRequestSchema,
} from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  actionItemFormSchema,
  emptyActionItem,
  emptySchedule,
  notesFormSchema,
  scheduleFormSchema,
  toCreateActionItem,
  toCreateMeeting,
  toUpdateNotes,
  toUpdateWhen,
  whenFormSchema,
  type ScheduleFormValues,
} from './forms';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));
const base: ScheduleFormValues = { ...emptySchedule(), date: '2026-11-02', time: '10:00' };

describe('schedule form', () => {
  it('accepts a minimal meeting with the default length and sends only what is filled in', () => {
    expect(scheduleFormSchema.safeParse(base).success).toBe(true);
    const body = toCreateMeeting(base);
    expect(body).toEqual({ date: '2026-11-02', time: '10:00', durationMinutes: 30 });
    expect(createOneOnOneRequestSchema.safeParse(body).success).toBe(true);
  });

  it('sends the report and the agenda when chosen', () => {
    const body = toCreateMeeting({
      ...base,
      employeeId: ID,
      agenda: ' Career ',
      durationMinutes: '45',
    });
    expect(body).toEqual({
      employeeId: ID,
      date: '2026-11-02',
      time: '10:00',
      durationMinutes: 45,
      agenda: 'Career',
    });
    expect(createOneOnOneRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['no date', { date: '' }, ['date:required']],
    ['a bad date', { date: '2.11.2026' }, ['date:invalidDate']],
    ['no time', { time: '' }, ['time:required']],
    ['a bad time', { time: '25:00' }, ['time:invalidTime']],
    ['14 minutes', { durationMinutes: '14' }, ['durationMinutes:invalidMinutes']],
    ['241 minutes', { durationMinutes: '241' }, ['durationMinutes:invalidMinutes']],
    ['minutes that are not a number', { durationMinutes: 'a' }, ['durationMinutes:invalidMinutes']],
    ['half minutes', { durationMinutes: '30.5' }, ['durationMinutes:invalidMinutes']],
    ['a long agenda', { agenda: 'x'.repeat(1001) }, ['agenda:tooLong']],
  ])('refuses %s, as the API does', (_label, change, expected) => {
    expect(issues(scheduleFormSchema.safeParse({ ...base, ...change }))).toEqual(expected);
  });

  it('accepts the limits of the API and nothing beyond them', () => {
    for (const minutes of ['15', '240']) {
      expect(scheduleFormSchema.safeParse({ ...base, durationMinutes: minutes }).success).toBe(
        true,
      );
      expect(
        createOneOnOneRequestSchema.safeParse(
          toCreateMeeting({ ...base, durationMinutes: minutes }),
        ).success,
      ).toBe(true);
    }
    expect(scheduleFormSchema.safeParse({ ...base, agenda: 'x'.repeat(1000) }).success).toBe(true);
    expect(
      createOneOnOneRequestSchema.safeParse({
        date: '2026-11-02',
        time: '10:00',
        durationMinutes: 14,
      }).success,
    ).toBe(false);
  });
});

describe('changing the time', () => {
  const current = { date: '2026-11-02', time: '10:00', durationMinutes: '30' };

  it('sends nothing when nothing changed, date and time together, and the length alone', () => {
    expect(toUpdateWhen(current, current)).toEqual({});
    expect(toUpdateWhen({ ...current, time: '11:00' }, current)).toEqual({
      date: '2026-11-02',
      time: '11:00',
    });
    expect(toUpdateWhen({ ...current, durationMinutes: '60' }, current)).toEqual({
      durationMinutes: 60,
    });
    const body = toUpdateWhen(
      { date: '2026-11-03', time: '09:15', durationMinutes: '45' },
      current,
    );
    expect(updateOneOnOneRequestSchema.safeParse(body).success).toBe(true);
  });

  it('checks the same rules as scheduling', () => {
    expect(issues(whenFormSchema.safeParse({ ...current, time: '99:00' }))).toEqual([
      'time:invalidTime',
    ]);
    expect(issues(whenFormSchema.safeParse({ ...current, durationMinutes: '5' }))).toEqual([
      'durationMinutes:invalidMinutes',
    ]);
  });
});

describe('notes form', () => {
  const current = { agenda: 'A', sharedNotes: 'S', privateNotes: 'P' };

  it('sends only the texts that changed and clears with null', () => {
    expect(toUpdateNotes(current, current)).toEqual({});
    expect(toUpdateNotes({ ...current, sharedNotes: ' new ' }, current)).toEqual({
      sharedNotes: 'new',
    });
    const cleared = toUpdateNotes({ agenda: ' ', sharedNotes: 'S', privateNotes: '' }, current);
    expect(cleared).toEqual({ agenda: null, privateNotes: null });
    expect(updateOneOnOneRequestSchema.safeParse(cleared).success).toBe(true);
  });

  it('has the same limits as the API', () => {
    expect(notesFormSchema.safeParse({ ...current, sharedNotes: 'x'.repeat(2000) }).success).toBe(
      true,
    );
    expect(
      issues(notesFormSchema.safeParse({ ...current, privateNotes: 'x'.repeat(2001) })),
    ).toEqual(['privateNotes:tooLong']);
    expect(issues(notesFormSchema.safeParse({ ...current, agenda: 'x'.repeat(1001) }))).toEqual([
      'agenda:tooLong',
    ]);
    expect(updateOneOnOneRequestSchema.safeParse({ privateNotes: 'x'.repeat(2001) }).success).toBe(
      false,
    );
  });
});

describe('action item form', () => {
  it('builds what the API accepts', () => {
    const filled = { ...emptyActionItem(), title: ' Send notes ' };
    expect(actionItemFormSchema.safeParse(filled).success).toBe(true);
    expect(toCreateActionItem(filled)).toEqual({ title: 'Send notes' });
    const full = toCreateActionItem({ title: 'x', ownerEmployeeId: ID, dueDate: '2026-11-09' });
    expect(full).toEqual({ title: 'x', ownerEmployeeId: ID, dueDate: '2026-11-09' });
    expect(createActionItemRequestSchema.safeParse(full).success).toBe(true);
  });

  it.each([
    ['no title', { title: ' ' }, ['title:required']],
    ['a long title', { title: 'x'.repeat(121) }, ['title:tooLong']],
    ['a bad date', { title: 'x', dueDate: '9.11.2026' }, ['dueDate:invalidDate']],
  ])('refuses %s', (_label, change, expected) => {
    expect(issues(actionItemFormSchema.safeParse({ ...emptyActionItem(), ...change }))).toEqual(
      expected,
    );
  });
});
