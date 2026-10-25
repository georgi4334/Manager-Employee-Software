import {
  createGoalRequestSchema,
  createKeyResultRequestSchema,
  goalCheckInRequestSchema,
  updateGoalRequestSchema,
} from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  checkInFormSchema,
  currentValueSchema,
  emptyGoal,
  emptyKeyResult,
  goalFormSchema,
  keyResultFormSchema,
  toCheckIn,
  toCreateGoal,
  toCreateKeyResult,
  toCurrentValue,
  toUpdateGoal,
  type GoalFormValues,
} from './forms';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));

const base: GoalFormValues = { ...emptyGoal(), title: ' Learn Rust ' };

describe('goal form', () => {
  it('accepts a minimal goal and sends only what is filled in', () => {
    expect(goalFormSchema.safeParse(base).success).toBe(true);
    const body = toCreateGoal(base);
    expect(body).toEqual({
      scope: 'personal',
      title: 'Learn Rust',
      status: 'active',
      progressPct: 0,
    });
    expect(createGoalRequestSchema.safeParse(body).success).toBe(true);
  });

  it('maps every field to what the API accepts', () => {
    const team = toCreateGoal({
      ...base,
      scope: 'team',
      teamId: ID,
      description: ' text ',
      dueDate: '2026-12-01',
      parentGoalId: ID,
      progressPct: '40',
    });
    expect(team).toMatchObject({
      teamId: ID,
      description: 'text',
      parentGoalId: ID,
      progressPct: 40,
    });
    expect(createGoalRequestSchema.safeParse(team).success).toBe(true);
    const forOther = toCreateGoal({ ...base, employeeId: ID });
    expect(forOther.employeeId).toBe(ID);
    expect(createGoalRequestSchema.safeParse(forOther).success).toBe(true);
    // a person or team that no longer applies to the scope is never sent
    expect(
      toCreateGoal({ ...base, scope: 'company', teamId: ID, employeeId: ID }),
    ).not.toHaveProperty('teamId');
    expect(toCreateGoal({ ...base, scope: 'team', teamId: ID, employeeId: ID })).not.toHaveProperty(
      'employeeId',
    );
  });

  it.each([
    ['no title', { title: ' ' }, ['title:required']],
    ['a long title', { title: 'x'.repeat(121) }, ['title:tooLong']],
    ['a long description', { description: 'x'.repeat(1001) }, ['description:tooLong']],
    ['a team goal without a team', { scope: 'team' as const }, ['teamId:required']],
    ['a bad date', { dueDate: '1.2.2027' }, ['dueDate:invalidDate']],
    ['progress over 100', { progressPct: '101' }, ['progressPct:invalidPercent']],
    ['progress that is not a number', { progressPct: 'a' }, ['progressPct:invalidPercent']],
    ['negative progress', { progressPct: '-1' }, ['progressPct:invalidPercent']],
  ])('refuses %s, as the API does', (_label, change, expected) => {
    const values = { ...base, ...change };
    expect(issues(goalFormSchema.safeParse(values))).toEqual(expected);
  });

  it('has the same limits as the contracts', () => {
    const edge = {
      ...base,
      title: 'x'.repeat(120),
      description: 'x'.repeat(1000),
      progressPct: '100',
    };
    expect(goalFormSchema.safeParse(edge).success).toBe(true);
    expect(createGoalRequestSchema.safeParse(toCreateGoal(edge)).success).toBe(true);
    expect(
      createGoalRequestSchema.safeParse({ ...toCreateGoal(base), title: 'x'.repeat(121) }).success,
    ).toBe(false);
  });

  it('sends only the changed fields when editing, and clears with null', () => {
    const current: GoalFormValues = {
      ...base,
      title: 'Learn Rust',
      description: 'old',
      dueDate: '2026-12-01',
      parentGoalId: ID,
    };
    expect(toUpdateGoal(current, current)).toEqual({});
    const body = toUpdateGoal(
      {
        ...current,
        title: ' New ',
        description: ' ',
        dueDate: '',
        parentGoalId: '',
        status: 'done',
        progressPct: '70',
      },
      current,
    );
    expect(body).toEqual({
      title: 'New',
      description: null,
      dueDate: null,
      parentGoalId: null,
      status: 'done',
      progressPct: 70,
    });
    expect(updateGoalRequestSchema.safeParse(body).success).toBe(true);
  });
});

describe('key result form', () => {
  const filled = { ...emptyKeyResult(), title: ' Users ', targetValue: '1000' };

  it('builds what the API accepts, with decimal commas', () => {
    expect(keyResultFormSchema.safeParse(filled).success).toBe(true);
    expect(toCreateKeyResult(filled)).toEqual({ title: 'Users', startValue: 0, targetValue: 1000 });
    const full = toCreateKeyResult({
      ...filled,
      unit: ' % ',
      startValue: '2,5',
      currentValue: '10,5',
    });
    expect(full).toEqual({
      title: 'Users',
      unit: '%',
      startValue: 2.5,
      targetValue: 1000,
      currentValue: 10.5,
    });
    expect(createKeyResultRequestSchema.safeParse(full).success).toBe(true);
  });

  it.each([
    ['no title', { title: '' }, ['title:required']],
    ['no target', { targetValue: '' }, ['targetValue:invalidNumber']],
    ['a target that is not a number', { targetValue: 'x' }, ['targetValue:invalidNumber']],
    ['a target equal to the start', { targetValue: '0' }, ['targetValue:sameAsStart']],
    ['a current value that is not a number', { currentValue: 'x' }, ['currentValue:invalidNumber']],
    ['a long unit', { unit: 'x'.repeat(21) }, ['unit:tooLong']],
    ['a huge value', { targetValue: '1000000001' }, ['targetValue:invalidNumber']],
  ])('refuses %s', (_label, change, expected) => {
    expect(issues(keyResultFormSchema.safeParse({ ...filled, ...change }))).toEqual(expected);
  });

  it('refuses what the API refuses (same start and target)', () => {
    expect(
      createKeyResultRequestSchema.safeParse({ title: 'x', startValue: 0, targetValue: 0 }).success,
    ).toBe(false);
  });

  it('checks the current value on its own', () => {
    expect(currentValueSchema.safeParse({ currentValue: '12,5' }).success).toBe(true);
    expect(toCurrentValue({ currentValue: '12,5' })).toEqual({ currentValue: 12.5 });
    expect(issues(currentValueSchema.safeParse({ currentValue: '' }))).toEqual([
      'currentValue:invalidNumber',
    ]);
  });
});

describe('check-in form', () => {
  it('sends no comment when empty and trims otherwise', () => {
    expect(toCheckIn({ comment: '  ' })).toEqual({});
    expect(toCheckIn({ comment: ' ok ' })).toEqual({ comment: 'ok' });
    expect(goalCheckInRequestSchema.safeParse(toCheckIn({ comment: ' ok ' })).success).toBe(true);
  });

  it('refuses a long comment', () => {
    expect(checkInFormSchema.safeParse({ comment: 'x'.repeat(500) }).success).toBe(true);
    expect(issues(checkInFormSchema.safeParse({ comment: 'x'.repeat(501) }))).toEqual([
      'comment:tooLong',
    ]);
    expect(goalCheckInRequestSchema.safeParse({ comment: 'x'.repeat(501) }).success).toBe(false);
  });
});
