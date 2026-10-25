import { describe, expect, it } from 'vitest';
import {
  MAX_TASK_TITLE,
  createTaskRequestSchema,
  isOverdue,
  taskKey,
  taskQuerySchema,
  updateTaskRequestSchema,
} from './tasks.js';

const ID = '0192f5a0-0000-7000-8000-00000000000a';

describe('task reference and overdue', () => {
  it('joins project code and number', () => {
    expect(taskKey('WEB', 12)).toBe('WEB-12');
    expect(taskKey('A-1', 3)).toBe('A-1-3');
  });
  it('is overdue only before today and only while not done', () => {
    const today = '2026-11-10';
    expect(isOverdue({ dueDate: '2026-11-09', status: 'todo' }, today)).toBe(true);
    expect(isOverdue({ dueDate: today, status: 'todo' }, today)).toBe(false);
    expect(isOverdue({ dueDate: '2026-12-01', status: 'review' }, today)).toBe(false);
    expect(isOverdue({ dueDate: '2026-11-01', status: 'done' }, today)).toBe(false);
    expect(isOverdue({ dueDate: null, status: 'todo' }, today)).toBe(false);
  });
});

describe('creating a task', () => {
  it('needs only a title and applies the defaults', () => {
    expect(createTaskRequestSchema.parse({ title: ' Fix login ' })).toEqual({
      title: 'Fix login',
      type: 'functional',
      status: 'todo',
      priority: 'normal',
    });
  });
  it('takes every field and half-hour estimates', () => {
    expect(
      createTaskRequestSchema.safeParse({
        title: 'x',
        description: ' d ',
        type: 'non_functional',
        status: 'review',
        priority: 'high',
        milestoneId: ID,
        assigneeEmployeeId: ID,
        estimateHours: 7.5,
        dueDate: '2026-12-01',
      }).success,
    ).toBe(true);
  });
  it.each([
    ['no title', {}],
    ['a blank title', { title: ' ' }],
    ['a long title', { title: 'x'.repeat(MAX_TASK_TITLE + 1) }],
    ['an unknown type', { title: 'x', type: 'bug' }],
    ['an unknown status', { title: 'x', status: 'blocked' }],
    ['an unknown priority', { title: 'x', priority: 'urgent' }],
    ['an estimate in odd fractions', { title: 'x', estimateHours: 1.3 }],
    ['a negative estimate', { title: 'x', estimateHours: -1 }],
    ['an estimate above the limit', { title: 'x', estimateHours: 1000.5 }],
    ['a bad date', { title: 'x', dueDate: '1.12.2026' }],
    ['a bad assignee', { title: 'x', assigneeEmployeeId: 'nope' }],
    ['a forged number', { title: 'x', number: 7 }],
    ['a forged done date', { title: 'x', doneOn: '2026-12-01' }],
  ])('refuses %s', (_label, body) => {
    expect(createTaskRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('updating a task', () => {
  it('changes some fields and clears others with null or empty text', () => {
    expect(updateTaskRequestSchema.parse({ status: 'done' })).toEqual({ status: 'done' });
    expect(
      updateTaskRequestSchema.parse({
        description: ' ',
        milestoneId: null,
        assigneeEmployeeId: null,
        estimateHours: null,
        dueDate: null,
      }),
    ).toEqual({
      description: null,
      milestoneId: null,
      assigneeEmployeeId: null,
      estimateHours: null,
      dueDate: null,
    });
  });
  it.each([[{}], [{ status: 'blocked' }], [{ projectId: ID }], [{ number: 3 }], [{ title: '' }]])(
    'refuses %j',
    (body) => {
      expect(updateTaskRequestSchema.safeParse(body).success).toBe(false);
    },
  );
});

describe('listing tasks', () => {
  it('has defaults and bounded pages', () => {
    expect(taskQuerySchema.parse({})).toMatchObject({
      status: 'all',
      type: 'all',
      page: 1,
      pageSize: 50,
    });
    expect(taskQuerySchema.safeParse({ pageSize: 201 }).success).toBe(false);
  });
  it('accepts me, none, an id, and the open shortcut; refuses the rest', () => {
    for (const assignee of ['me', 'none', ID]) {
      expect(taskQuerySchema.safeParse({ assignee }).success).toBe(true);
    }
    expect(taskQuerySchema.safeParse({ status: 'open' }).success).toBe(true);
    for (const body of [
      { assignee: 'everyone' },
      { status: 'x' },
      { type: 'x' },
      { projectId: 'x' },
    ]) {
      expect(taskQuerySchema.safeParse(body).success).toBe(false);
    }
  });
});
