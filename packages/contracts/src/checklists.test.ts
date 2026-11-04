import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_LIMITS,
  checklistDueDate,
  checklistItemState,
  checklistProgress,
  checklistReminderDue,
  checklistStatusFor,
  createChecklistItemRequestSchema,
  startChecklistRequestSchema,
  templateRequestSchema,
  updateChecklistItemRequestSchema,
} from './checklists.js';

const UUID = '0192f5a0-0000-7000-8000-000000000001';

describe('checklistDueDate', () => {
  it('counts days from the anchor, before and after, across months and years', () => {
    expect(checklistDueDate('2026-11-02', 0)).toBe('2026-11-02');
    expect(checklistDueDate('2026-11-02', -7)).toBe('2026-10-26');
    expect(checklistDueDate('2026-12-30', 3)).toBe('2027-01-02');
  });
});

describe('checklistReminderDue', () => {
  const today = '2026-11-04';
  it.each([
    ['today', '2026-11-04', true],
    ['tomorrow', '2026-11-05', true],
    ['in two days', '2026-11-06', false],
    ['yesterday (overdue)', '2026-11-03', false],
  ])('an open step due %s: %s', (_label, dueDate, expected) => {
    expect(checklistReminderDue({ dueDate, done: false }, today)).toBe(expected);
  });

  it('never reminds a done step', () => {
    expect(checklistReminderDue({ dueDate: today, done: true }, today)).toBe(false);
  });

  it('crosses a month and a year end', () => {
    expect(checklistReminderDue({ dueDate: '2027-01-01', done: false }, '2026-12-31')).toBe(true);
    expect(checklistReminderDue({ dueDate: '2026-12-01', done: false }, '2026-11-30')).toBe(true);
  });
});

describe('checklistItemState', () => {
  const today = '2026-11-10';
  it('is done whatever the date', () => {
    expect(checklistItemState({ dueDate: '2026-01-01', done: true }, today)).toBe('done');
  });
  it('is overdue after the due date, not on it', () => {
    expect(checklistItemState({ dueDate: '2026-11-09', done: false }, today)).toBe('overdue');
    expect(checklistItemState({ dueDate: today, done: false }, today)).toBe('due_soon');
  });
  it('is due soon within three days, open after that', () => {
    expect(checklistItemState({ dueDate: '2026-11-13', done: false }, today)).toBe('due_soon');
    expect(checklistItemState({ dueDate: '2026-11-14', done: false }, today)).toBe('open');
  });
});

describe('checklistProgress', () => {
  it('counts and rounds', () => {
    expect(checklistProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
    expect(checklistProgress([{ done: true }, { done: false }, { done: false }])).toEqual({
      done: 1,
      total: 3,
      percent: 33,
    });
    expect(checklistProgress([{ done: true }, { done: true }])).toEqual({
      done: 2,
      total: 2,
      percent: 100,
    });
  });
});

describe('checklistStatusFor', () => {
  it('is done when every item is, open otherwise', () => {
    expect(checklistStatusFor('open', [{ done: true }])).toBe('done');
    expect(checklistStatusFor('done', [{ done: true }, { done: false }])).toBe('open');
  });
  it('keeps an empty checklist open and a cancelled one cancelled', () => {
    expect(checklistStatusFor('open', [])).toBe('open');
    expect(checklistStatusFor('cancelled', [{ done: true }])).toBe('cancelled');
  });
});

describe('templateRequestSchema', () => {
  const item = { title: ' Laptop ', responsible: 'hr', offsetDays: -3 } as const;
  it('accepts a template and trims, empty description becomes null', () => {
    const parsed = templateRequestSchema.parse({
      name: 'Standard',
      kind: 'onboarding',
      items: [{ ...item, description: '' }],
    });
    expect(parsed.isDefault).toBe(false);
    expect(parsed.items[0]).toEqual({
      title: 'Laptop',
      description: null,
      responsible: 'hr',
      offsetDays: -3,
    });
  });
  it.each([
    ['empty name', { name: ' ', kind: 'onboarding', items: [] }],
    ['unknown kind', { name: 'x', kind: 'transfer', items: [] }],
    ['offset too early', { name: 'x', kind: 'onboarding', items: [{ ...item, offsetDays: -61 }] }],
    ['offset too late', { name: 'x', kind: 'onboarding', items: [{ ...item, offsetDays: 181 }] }],
    ['broken offset', { name: 'x', kind: 'onboarding', items: [{ ...item, offsetDays: 1.5 }] }],
    [
      'unknown responsible',
      { name: 'x', kind: 'onboarding', items: [{ ...item, responsible: 'it' }] },
    ],
    ['long title', { name: 'x', kind: 'onboarding', items: [{ ...item, title: 'a'.repeat(121) }] }],
    [
      'too many items',
      { name: 'x', kind: 'onboarding', items: Array(CHECKLIST_LIMITS.items + 1).fill(item) },
    ],
    ['extra field', { name: 'x', kind: 'onboarding', items: [], tenantId: UUID }],
  ])('refuses %s', (_, body) => {
    expect(templateRequestSchema.safeParse(body).success).toBe(false);
  });
  it('accepts the boundaries', () => {
    expect(
      templateRequestSchema.safeParse({
        name: 'a'.repeat(80),
        kind: 'offboarding',
        items: [
          { ...item, offsetDays: -60 },
          { ...item, offsetDays: 180 },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('other requests', () => {
  it('start needs an employee and a template, the date is optional but must be a date', () => {
    expect(
      startChecklistRequestSchema.safeParse({ employeeId: UUID, templateId: UUID }).success,
    ).toBe(true);
    expect(
      startChecklistRequestSchema.safeParse({
        employeeId: UUID,
        templateId: UUID,
        anchorDate: '2026-13-01',
      }).success,
    ).toBe(false);
    expect(startChecklistRequestSchema.safeParse({ employeeId: UUID }).success).toBe(false);
  });
  it('an item needs a title, a responsible and a due date', () => {
    expect(
      createChecklistItemRequestSchema.safeParse({
        title: 'Welcome lunch',
        responsible: 'manager',
        dueDate: '2026-11-02',
      }).success,
    ).toBe(true);
    expect(
      createChecklistItemRequestSchema.safeParse({ title: 'x', responsible: 'manager' }).success,
    ).toBe(false);
  });
  it('an update needs at least one field and may clear the assignee', () => {
    expect(updateChecklistItemRequestSchema.safeParse({}).success).toBe(false);
    expect(updateChecklistItemRequestSchema.parse({ assigneeEmployeeId: null })).toEqual({
      assigneeEmployeeId: null,
    });
  });
});
