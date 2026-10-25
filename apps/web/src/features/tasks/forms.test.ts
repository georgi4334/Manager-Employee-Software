import { createTaskRequestSchema, updateTaskRequestSchema } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  emptyTask,
  taskFormSchema,
  toCreateTask,
  toUpdateTask,
  type TaskFormValues,
} from './forms';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));

const base: TaskFormValues = { ...emptyTask(ID), title: ' Write the login ' };

describe('task form', () => {
  it('accepts a minimal task and sends only what is filled in', () => {
    expect(taskFormSchema.safeParse(base).success).toBe(true);
    const body = toCreateTask(base);
    expect(body).toEqual({
      title: 'Write the login',
      type: 'functional',
      status: 'todo',
      priority: 'normal',
    });
    expect(createTaskRequestSchema.safeParse(body).success).toBe(true);
  });

  it('maps every field to what the API accepts', () => {
    const full = toCreateTask({
      ...base,
      description: ' text ',
      type: 'non_functional',
      status: 'review',
      priority: 'high',
      milestoneId: ID,
      assigneeEmployeeId: ID,
      estimateHours: '2.5',
      dueDate: '2026-12-01',
    });
    expect(full).toMatchObject({ description: 'text', estimateHours: 2.5, dueDate: '2026-12-01' });
    expect(createTaskRequestSchema.safeParse(full).success).toBe(true);
  });

  it.each([
    ['no title', { title: ' ' }, ['title:required']],
    ['a long title', { title: 'x'.repeat(121) }, ['title:tooLong']],
    ['a long description', { description: 'x'.repeat(2001) }, ['description:tooLong']],
    ['no project', { projectId: '' }, ['projectId:required']],
    ['odd fractions of an hour', { estimateHours: '1.3' }, ['estimateHours:invalidHours']],
    ['a negative estimate', { estimateHours: '-1' }, ['estimateHours:invalidHours']],
    ['an estimate over 1000', { estimateHours: '1001' }, ['estimateHours:invalidHours']],
    ['a bad date', { dueDate: '2.11.2026' }, ['dueDate:invalidDate']],
  ])('refuses %s, as the API does', (_label, patch, expected) => {
    const values = { ...base, ...patch };
    expect(issues(taskFormSchema.safeParse(values))).toEqual(expected);
    if (!('projectId' in patch)) {
      expect(createTaskRequestSchema.safeParse(toCreateTask(values)).success).toBe(false);
    }
  });

  it('boundaries: 1000 hours and half hours are fine', () => {
    for (const estimateHours of ['0', '0.5', '1000']) {
      expect(taskFormSchema.safeParse({ ...base, estimateHours }).success).toBe(true);
    }
  });

  it('sends only what changed when editing, and clears with null', () => {
    const current: TaskFormValues = {
      ...base,
      title: 'Write the login',
      description: 'old',
      milestoneId: ID,
      assigneeEmployeeId: ID,
      estimateHours: '3',
      dueDate: '2026-12-01',
    };
    expect(toUpdateTask(current, current)).toEqual({});
    const changed = toUpdateTask(
      {
        ...current,
        description: '',
        milestoneId: '',
        assigneeEmployeeId: '',
        estimateHours: '',
        dueDate: '',
        status: 'done',
      },
      current,
    );
    expect(changed).toEqual({
      description: null,
      milestoneId: null,
      assigneeEmployeeId: null,
      estimateHours: null,
      dueDate: null,
      status: 'done',
    });
    expect(updateTaskRequestSchema.safeParse(changed).success).toBe(true);
    expect(toUpdateTask({ ...current, title: 'New' }, current)).toEqual({ title: 'New' });
  });
});
