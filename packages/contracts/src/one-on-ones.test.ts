import { describe, expect, it } from 'vitest';
import {
  createActionItemRequestSchema,
  createOneOnOneRequestSchema,
  isActionItemOverdue,
  oneOnOneQuerySchema,
  updateActionItemRequestSchema,
  updateOneOnOneRequestSchema,
} from './one-on-ones.js';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const base = { date: '2026-11-02', time: '10:00' };
const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));

describe('isActionItemOverdue', () => {
  it.each([
    [{ dueDate: '2026-11-01', done: false }, true],
    [{ dueDate: '2026-11-02', done: false }, false],
    [{ dueDate: '2026-11-03', done: false }, false],
    [{ dueDate: '2026-11-01', done: true }, false],
    [{ dueDate: null, done: false }, false],
  ])('%j → %s (today 2026-11-02)', (item, expected) => {
    expect(isActionItemOverdue(item, '2026-11-02')).toBe(expected);
  });
});

describe('createOneOnOneRequestSchema', () => {
  it('defaults the duration and accepts a report and an agenda', () => {
    expect(createOneOnOneRequestSchema.parse(base)).toEqual({ ...base, durationMinutes: 30 });
    const full = createOneOnOneRequestSchema.parse({
      ...base,
      employeeId: ID,
      durationMinutes: 45,
      agenda: ' Career ',
    });
    expect(full).toMatchObject({ employeeId: ID, durationMinutes: 45, agenda: 'Career' });
    expect(createOneOnOneRequestSchema.parse({ ...base, agenda: '  ' }).agenda).toBeUndefined();
  });

  it.each([
    ['no date', { date: undefined }, ['date:Invalid input: expected string, received undefined']],
    ['a bad time', { time: '25:00' }, ['time:invalidTime']],
    ['a bad time format', { time: '9:00' }, ['time:invalidTime']],
    ['too short', { durationMinutes: 14 }, ['durationMinutes:invalid']],
    ['too long', { durationMinutes: 241 }, ['durationMinutes:invalid']],
    [
      'a fractional duration',
      { durationMinutes: 30.5 },
      ['durationMinutes:Invalid input: expected int, received number'],
    ],
    ['a long agenda', { agenda: 'x'.repeat(1001) }, ['agenda:tooLong']],
    ['a bad person', { employeeId: 'x' }, ['employeeId:Invalid UUID']],
  ])('refuses %s', (_label, change, expected) => {
    const result = createOneOnOneRequestSchema.safeParse({ ...base, ...change });
    expect(result.success).toBe(false);
    expect(issues(result)[0]?.split(':')[0]).toBe(expected[0]!.split(':')[0]);
  });

  it('accepts the limits and refuses unknown fields', () => {
    expect(createOneOnOneRequestSchema.safeParse({ ...base, durationMinutes: 15 }).success).toBe(
      true,
    );
    expect(createOneOnOneRequestSchema.safeParse({ ...base, durationMinutes: 240 }).success).toBe(
      true,
    );
    expect(
      createOneOnOneRequestSchema.safeParse({ ...base, agenda: 'x'.repeat(1000) }).success,
    ).toBe(true);
    expect(createOneOnOneRequestSchema.safeParse({ ...base, status: 'done' }).success).toBe(false);
  });
});

describe('updateOneOnOneRequestSchema', () => {
  it('needs at least one field, and date and time together', () => {
    expect(updateOneOnOneRequestSchema.safeParse({}).success).toBe(false);
    expect(updateOneOnOneRequestSchema.safeParse({ date: '2026-11-02' }).success).toBe(false);
    expect(updateOneOnOneRequestSchema.safeParse({ time: '10:00' }).success).toBe(false);
    expect(updateOneOnOneRequestSchema.safeParse(base).success).toBe(true);
  });

  it('clears texts with an empty string and checks lengths and status', () => {
    expect(
      updateOneOnOneRequestSchema.parse({ agenda: ' ', sharedNotes: '', privateNotes: ' ' }),
    ).toEqual({ agenda: null, sharedNotes: null, privateNotes: null });
    expect(updateOneOnOneRequestSchema.safeParse({ sharedNotes: 'x'.repeat(2001) }).success).toBe(
      false,
    );
    expect(updateOneOnOneRequestSchema.safeParse({ privateNotes: 'x'.repeat(2000) }).success).toBe(
      true,
    );
    expect(updateOneOnOneRequestSchema.safeParse({ status: 'done' }).success).toBe(true);
    expect(updateOneOnOneRequestSchema.safeParse({ status: 'later' }).success).toBe(false);
    expect(updateOneOnOneRequestSchema.safeParse({ employeeId: ID }).success).toBe(false);
  });
});

describe('action items', () => {
  it('creates with a title, an optional owner and due date', () => {
    expect(createActionItemRequestSchema.parse({ title: ' Send notes ' })).toEqual({
      title: 'Send notes',
    });
    expect(
      createActionItemRequestSchema.safeParse({
        title: 'x',
        ownerEmployeeId: ID,
        dueDate: '2026-11-09',
      }).success,
    ).toBe(true);
  });

  it.each([
    ['no title', { title: ' ' }],
    ['a long title', { title: 'x'.repeat(121) }],
    ['a bad owner', { title: 'x', ownerEmployeeId: 'nope' }],
    ['a bad date', { title: 'x', dueDate: '9.11.2026' }],
    ['unknown fields', { title: 'x', done: true }],
  ])('refuses %s', (_label, body) => {
    expect(createActionItemRequestSchema.safeParse(body).success).toBe(false);
  });

  it('updates part of an item and clears the due date', () => {
    expect(updateActionItemRequestSchema.safeParse({}).success).toBe(false);
    expect(updateActionItemRequestSchema.parse({ dueDate: null, done: true })).toEqual({
      dueDate: null,
      done: true,
    });
    expect(updateActionItemRequestSchema.safeParse({ done: 'yes' }).success).toBe(false);
    expect(updateActionItemRequestSchema.safeParse({ title: '' }).success).toBe(false);
  });
});

describe('oneOnOneQuerySchema', () => {
  it('defaults to upcoming, page 1', () => {
    expect(oneOnOneQuerySchema.parse({})).toEqual({ status: 'upcoming', page: 1, pageSize: 25 });
  });
  it('refuses unknown values and huge pages', () => {
    expect(oneOnOneQuerySchema.safeParse({ status: 'x' }).success).toBe(false);
    expect(oneOnOneQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(oneOnOneQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  });
});
