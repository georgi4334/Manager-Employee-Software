import {
  createChecklistItemRequestSchema,
  startChecklistRequestSchema,
  templateRequestSchema,
  updateChecklistItemRequestSchema,
} from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  emptyStep,
  itemFormSchema,
  startFormSchema,
  templateFormSchema,
  templateValues,
  toCreateItem,
  toStartRequest,
  toTemplateRequest,
  toUpdateItem,
} from './forms';

const UUID = '0192f5a0-0000-7000-8000-000000000001';

describe('template form', () => {
  it('turns valid values into a request the API accepts', () => {
    const values = {
      ...templateValues(),
      name: ' Welcome ',
      items: [{ ...emptyStep(), title: 'Laptop', offsetDays: '-3', description: ' ' }],
    };
    expect(templateFormSchema.safeParse(values).success).toBe(true);
    const body = toTemplateRequest(values);
    expect(body).toEqual({
      name: 'Welcome',
      kind: 'onboarding',
      isDefault: false,
      items: [{ title: 'Laptop', description: null, responsible: 'hr', offsetDays: -3 }],
    });
    expect(templateRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['an empty name', { name: '' }, 'required'],
    ['a name that is too long', { name: 'a'.repeat(81) }, 'tooLong'],
  ])('refuses %s like the API', (_, change, message) => {
    const result = templateFormSchema.safeParse({ ...templateValues(), ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });

  it.each(['-61', '181', '1.5', 'x', ''])('refuses the offset "%s"', (offsetDays) => {
    const result = templateFormSchema.safeParse({
      ...templateValues(),
      name: 'x',
      items: [{ ...emptyStep(), title: 'x', offsetDays }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('invalidDays');
  });

  it('accepts the offset boundaries', () => {
    for (const offsetDays of ['-60', '180']) {
      expect(
        templateFormSchema.safeParse({
          ...templateValues(),
          name: 'x',
          items: [{ ...emptyStep(), title: 'x', offsetDays }],
        }).success,
      ).toBe(true);
    }
  });
});

describe('item form', () => {
  const values = {
    title: 'Lunch',
    description: '',
    responsible: 'manager' as const,
    dueDate: '2026-11-03',
    assigneeEmployeeId: '',
  };
  it('a new item without an assignee leaves it to the server', () => {
    expect(itemFormSchema.safeParse(values).success).toBe(true);
    const body = toCreateItem(values);
    expect(body).not.toHaveProperty('assigneeEmployeeId');
    expect(createChecklistItemRequestSchema.safeParse(body).success).toBe(true);
  });
  it('an existing item without an assignee goes to the HR group', () => {
    const body = toUpdateItem(values);
    expect(body.assigneeEmployeeId).toBeNull();
    expect(updateChecklistItemRequestSchema.safeParse(body).success).toBe(true);
    expect(toUpdateItem({ ...values, assigneeEmployeeId: UUID }).assigneeEmployeeId).toBe(UUID);
  });
  it('needs a title and a date', () => {
    expect(itemFormSchema.safeParse({ ...values, title: ' ' }).success).toBe(false);
    expect(itemFormSchema.safeParse({ ...values, dueDate: '3.11.2026' }).success).toBe(false);
  });
});

describe('start form', () => {
  it('needs a person and a template; the date is optional', () => {
    expect(
      startFormSchema.safeParse({ employeeId: '', templateId: '', anchorDate: '' }).success,
    ).toBe(false);
    const body = toStartRequest({ employeeId: UUID, templateId: UUID, anchorDate: '' });
    expect(body).toEqual({ employeeId: UUID, templateId: UUID });
    expect(startChecklistRequestSchema.safeParse(body).success).toBe(true);
    expect(
      toStartRequest({ employeeId: UUID, templateId: UUID, anchorDate: '2026-11-03' }).anchorDate,
    ).toBe('2026-11-03');
  });
});
