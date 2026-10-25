import { describe, expect, it } from 'vitest';
import {
  canAlign,
  goalCheckInRequestSchema,
  createGoalRequestSchema,
  createKeyResultRequestSchema,
  goalProgress,
  goalQuerySchema,
  isGoalOverdue,
  keyResultProgress,
  updateGoalRequestSchema,
  updateKeyResultRequestSchema,
} from './goals.js';

const ID = '0192f5a0-0000-7000-8000-00000000000a';

describe('keyResultProgress', () => {
  it.each([
    [0, 100, 0, 0],
    [0, 100, 50, 50],
    [0, 100, 100, 100],
    [0, 100, 150, 100], // beyond the target counts as reached
    [0, 100, -20, 0], // before the start counts as nothing
    [10, 20, 12.5, 25],
    [0, 3, 1, 33],
    [0, 3, 2, 67],
  ])('start %d target %d current %d → %d %%', (start, target, current, expected) => {
    expect(keyResultProgress({ start, target, current })).toBe(expected);
  });
  it('measures a goal to reduce something the other way round', () => {
    expect(keyResultProgress({ start: 10, target: 2, current: 10 })).toBe(0);
    expect(keyResultProgress({ start: 10, target: 2, current: 6 })).toBe(50);
    expect(keyResultProgress({ start: 10, target: 2, current: 2 })).toBe(100);
    expect(keyResultProgress({ start: 10, target: 2, current: 12 })).toBe(0);
  });
  it('cannot measure a target equal to the start', () => {
    expect(keyResultProgress({ start: 5, target: 5, current: 5 })).toBe(0);
  });
});

describe('goalProgress', () => {
  it('uses the manual value while there are no key results, clamped', () => {
    expect(goalProgress(40, [])).toBe(40);
    expect(goalProgress(140, [])).toBe(100);
    expect(goalProgress(-5, [])).toBe(0);
  });
  it('uses the average of the key results, ignoring the manual value', () => {
    expect(
      goalProgress(99, [
        { start: 0, target: 10, current: 10 },
        { start: 0, target: 10, current: 0 },
      ]),
    ).toBe(50);
    expect(
      goalProgress(0, [
        { start: 0, target: 3, current: 1 },
        { start: 0, target: 3, current: 1 },
        { start: 0, target: 3, current: 2 },
      ]),
    ).toBe(44); // (33 + 33 + 67) / 3
  });
});

describe('canAlign', () => {
  it.each([
    ['personal', 'team', true],
    ['personal', 'company', true],
    ['team', 'company', true],
    ['personal', 'personal', false],
    ['team', 'team', false],
    ['company', 'company', false],
    ['team', 'personal', false],
    ['company', 'team', false],
    ['company', 'personal', false],
  ] as const)('%s → %s: %s', (child, parent, ok) => {
    expect(canAlign(child, parent)).toBe(ok);
  });
});

describe('isGoalOverdue', () => {
  it('is overdue when open and past the due date, not on the day itself', () => {
    expect(isGoalOverdue({ dueDate: '2026-10-25', status: 'active' }, '2026-10-26')).toBe(true);
    expect(isGoalOverdue({ dueDate: '2026-10-26', status: 'active' }, '2026-10-26')).toBe(false);
    expect(isGoalOverdue({ dueDate: '2026-10-25', status: 'draft' }, '2026-10-26')).toBe(true);
  });
  it('is never overdue when finished, cancelled or without a date', () => {
    expect(isGoalOverdue({ dueDate: '2026-01-01', status: 'done' }, '2026-10-26')).toBe(false);
    expect(isGoalOverdue({ dueDate: '2026-01-01', status: 'cancelled' }, '2026-10-26')).toBe(false);
    expect(isGoalOverdue({ dueDate: null, status: 'active' }, '2026-10-26')).toBe(false);
  });
});

describe('createGoalRequestSchema', () => {
  it('accepts a personal, a team and a company goal with defaults', () => {
    expect(
      createGoalRequestSchema.parse({ scope: 'personal', title: ' Learn Rust ' }),
    ).toMatchObject({
      title: 'Learn Rust',
      status: 'active',
      progressPct: 0,
    });
    expect(
      createGoalRequestSchema.safeParse({ scope: 'team', teamId: ID, title: 'x' }).success,
    ).toBe(true);
    expect(createGoalRequestSchema.safeParse({ scope: 'company', title: 'x' }).success).toBe(true);
    expect(
      createGoalRequestSchema.safeParse({ scope: 'personal', employeeId: ID, title: 'x' }).success,
    ).toBe(true);
  });
  it.each([
    ['no title', { title: ' ' }],
    ['a long title', { title: 'x'.repeat(121) }],
    ['a long description', { description: 'x'.repeat(1001) }],
    ['a team goal without a team', { scope: 'team' }],
    ['a team on a personal goal', { teamId: ID }],
    ['an employee on a company goal', { scope: 'company', employeeId: ID }],
    ['an unknown status', { status: 'blocked' }],
    ['progress over 100', { progressPct: 101 }],
    ['fractional progress', { progressPct: 50.5 }],
    ['a bad date', { dueDate: '1.2.2027' }],
    ['unknown fields', { weight: 3 }],
  ])('refuses %s', (_label, patch) => {
    expect(
      createGoalRequestSchema.safeParse({ scope: 'personal', title: 'x', ...patch }).success,
    ).toBe(false);
  });
});

describe('updateGoalRequestSchema', () => {
  it('changes some fields and clears optional ones', () => {
    expect(updateGoalRequestSchema.safeParse({ dueDate: null, parentGoalId: null }).success).toBe(
      true,
    );
    expect(updateGoalRequestSchema.parse({ description: ' ' }).description).toBeNull();
  });
  it('needs something to change, and cannot change scope or owner', () => {
    expect(updateGoalRequestSchema.safeParse({}).success).toBe(false);
    expect(updateGoalRequestSchema.safeParse({ scope: 'company' }).success).toBe(false);
    expect(updateGoalRequestSchema.safeParse({ ownerEmployeeId: ID }).success).toBe(false);
  });
});

describe('key result schemas', () => {
  it('needs a title and a target different from the start', () => {
    expect(
      createKeyResultRequestSchema.safeParse({ title: 'Users', targetValue: 100 }).success,
    ).toBe(true);
    expect(
      createKeyResultRequestSchema.safeParse({ title: 'Users', startValue: 5, targetValue: 5 })
        .success,
    ).toBe(false);
    expect(createKeyResultRequestSchema.safeParse({ title: 'Users', targetValue: 0 }).success).toBe(
      false,
    ); // start 0
    expect(createKeyResultRequestSchema.safeParse({ title: ' ', targetValue: 1 }).success).toBe(
      false,
    );
    expect(createKeyResultRequestSchema.safeParse({ title: 'x', targetValue: 2e9 }).success).toBe(
      false,
    );
    expect(
      createKeyResultRequestSchema.safeParse({ title: 'x', unit: 'y'.repeat(21), targetValue: 1 })
        .success,
    ).toBe(false);
  });
  it('accepts a target below the start (reduce)', () => {
    expect(
      createKeyResultRequestSchema.safeParse({
        title: 'Bugs',
        startValue: 40,
        targetValue: 5,
        currentValue: 40,
      }).success,
    ).toBe(true);
  });
  it('updates partly, clears the unit, and needs something to change', () => {
    expect(updateKeyResultRequestSchema.safeParse({ currentValue: 12.5 }).success).toBe(true);
    expect(updateKeyResultRequestSchema.parse({ unit: ' ' }).unit).toBeNull();
    expect(updateKeyResultRequestSchema.safeParse({}).success).toBe(false);
    expect(updateKeyResultRequestSchema.safeParse({ currentValue: 'x' }).success).toBe(false);
  });
});

describe('check-ins and queries', () => {
  it('trims the comment, drops an empty one and limits the length', () => {
    expect(goalCheckInRequestSchema.parse({ comment: ' on track ' }).comment).toBe('on track');
    expect(goalCheckInRequestSchema.parse({ comment: ' ' }).comment).toBeUndefined();
    expect(goalCheckInRequestSchema.safeParse({}).success).toBe(true);
    expect(goalCheckInRequestSchema.safeParse({ comment: 'x'.repeat(501) }).success).toBe(false);
  });
  it('lists open goals of every scope by default', () => {
    expect(goalQuerySchema.parse({})).toMatchObject({
      scope: 'all',
      status: 'open',
      page: 1,
      pageSize: 25,
    });
    expect(goalQuerySchema.safeParse({ scope: 'region' }).success).toBe(false);
    expect(goalQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });
});
