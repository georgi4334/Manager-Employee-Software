import { z } from 'zod';
import { addDays, daysBetween, type DateString } from './dates.js';
import { dateOnlySchema } from './employees.js';

/** Onboarding and offboarding checklists (docs/adr/0040-onboarding-checklists.md). */
export const CHECKLIST_KINDS = ['onboarding', 'offboarding'] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

export const CHECKLIST_STATUSES = ['open', 'done', 'cancelled'] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

/** Who does an item: the person, their manager, or HR (resolved once when the checklist starts). */
export const CHECKLIST_RESPONSIBLES = ['employee', 'manager', 'hr'] as const;
export type ChecklistResponsible = (typeof CHECKLIST_RESPONSIBLES)[number];

export const CHECKLIST_LIMITS = {
  templates: 30,
  items: 50,
  name: 80,
  title: 120,
  description: 500,
  minOffset: -60,
  maxOffset: 180,
  /** An open item due within this many days is "due soon". */
  dueSoonDays: 3,
} as const;

// ----- pure rules ------------------------------------------------------------------------------

/** The due date of an item: the start or leaving date plus its offset in days. */
export const checklistDueDate = (anchor: DateString, offsetDays: number): DateString =>
  addDays(anchor, offsetDays);

export type ChecklistItemState = 'done' | 'overdue' | 'due_soon' | 'open';

/** The state of an item on a day (workspace time zone): computed, never stored. */
export function checklistItemState(
  item: { dueDate: DateString; done: boolean },
  today: DateString,
): ChecklistItemState {
  if (item.done) return 'done';
  if (item.dueDate < today) return 'overdue';
  if (daysBetween(today, item.dueDate) <= CHECKLIST_LIMITS.dueSoonDays) return 'due_soon';
  return 'open';
}

/** Done items, all items and the share done in whole percent (an empty checklist is 0 %). */
export function checklistProgress(items: readonly { done: boolean }[]): {
  done: number;
  total: number;
  percent: number;
} {
  const done = items.filter((item) => item.done).length;
  const total = items.length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** The status a checklist gets from its items: done when every item is, open otherwise (cancelled stays). */
export function checklistStatusFor(
  current: ChecklistStatus,
  items: readonly { done: boolean }[],
): ChecklistStatus {
  if (current === 'cancelled') return 'cancelled';
  return items.length > 0 && items.every((item) => item.done) ? 'done' : 'open';
}

// ----- requests --------------------------------------------------------------------------------

const name = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(CHECKLIST_LIMITS.name, { error: 'tooLong' });
const title = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(CHECKLIST_LIMITS.title, { error: 'tooLong' });
const description = z
  .string()
  .trim()
  .max(CHECKLIST_LIMITS.description, { error: 'tooLong' })
  .transform((v) => (v === '' ? null : v))
  .nullable();
const offsetDays = z
  .number()
  .int({ error: 'invalidDays' })
  .min(CHECKLIST_LIMITS.minOffset, { error: 'invalidDays' })
  .max(CHECKLIST_LIMITS.maxOffset, { error: 'invalidDays' });

export const templateItemInputSchema = z
  .object({
    title,
    description: description.default(null),
    responsible: z.enum(CHECKLIST_RESPONSIBLES),
    offsetDays,
  })
  .strict();
export type TemplateItemInput = z.infer<typeof templateItemInputSchema>;

/** Create or replace a template with its items (in order). */
export const templateRequestSchema = z
  .object({
    name,
    kind: z.enum(CHECKLIST_KINDS),
    isDefault: z.boolean().default(false),
    items: z.array(templateItemInputSchema).max(CHECKLIST_LIMITS.items, { error: 'tooMany' }),
  })
  .strict();
export type TemplateRequest = z.infer<typeof templateRequestSchema>;

export const startChecklistRequestSchema = z
  .object({
    employeeId: z.uuid(),
    templateId: z.uuid(),
    /** The start or leaving date the due dates count from; omitted = the hire or termination date, else today. */
    anchorDate: dateOnlySchema.optional(),
  })
  .strict();
export type StartChecklistRequest = z.infer<typeof startChecklistRequestSchema>;

export const createChecklistItemRequestSchema = z
  .object({
    title,
    description: description.default(null),
    responsible: z.enum(CHECKLIST_RESPONSIBLES),
    dueDate: dateOnlySchema,
    /** Omitted = resolved from `responsible` like a template item. */
    assigneeEmployeeId: z.uuid().nullable().optional(),
  })
  .strict();
export type CreateChecklistItemRequest = z.infer<typeof createChecklistItemRequestSchema>;

export const updateChecklistItemRequestSchema = z
  .object({
    title,
    description,
    responsible: z.enum(CHECKLIST_RESPONSIBLES),
    dueDate: dateOnlySchema,
    /** null = the HR group. */
    assigneeEmployeeId: z.uuid().nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'required' });
export type UpdateChecklistItemRequest = z.infer<typeof updateChecklistItemRequestSchema>;

export const checklistItemDoneRequestSchema = z.object({ done: z.boolean() }).strict();
export type ChecklistItemDoneRequest = z.infer<typeof checklistItemDoneRequestSchema>;

export const checklistQuerySchema = z.object({
  employeeId: z.uuid().optional(),
  kind: z.enum([...CHECKLIST_KINDS, 'all']).default('all'),
  status: z.enum([...CHECKLIST_STATUSES, 'all']).default('open'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ChecklistQuery = z.infer<typeof checklistQuerySchema>;

// ----- responses -------------------------------------------------------------------------------

const person = z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() });

export const templateItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  responsible: z.enum(CHECKLIST_RESPONSIBLES),
  offsetDays: z.number().int(),
});
export type TemplateItem = z.infer<typeof templateItemSchema>;

export const checklistTemplateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(CHECKLIST_KINDS),
  isDefault: z.boolean(),
  items: z.array(templateItemSchema),
  /** May change or delete it. */
  canEdit: z.boolean(),
});
export type ChecklistTemplate = z.infer<typeof checklistTemplateSchema>;

export const checklistTemplateListSchema = z.object({ items: z.array(checklistTemplateSchema) });
export type ChecklistTemplateList = z.infer<typeof checklistTemplateListSchema>;

export const checklistItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  responsible: z.enum(CHECKLIST_RESPONSIBLES),
  /** null = the HR group. */
  assignee: person.nullable(),
  dueDate: z.string(),
  done: z.boolean(),
  doneAt: z.string().nullable(),
  doneBy: person.nullable(),
  /** The caller may tick it (assignee, HR group member, or manager of the checklist). */
  canTick: z.boolean(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistSummarySchema = z.object({
  id: z.uuid(),
  employee: person,
  kind: z.enum(CHECKLIST_KINDS),
  name: z.string(),
  anchorDate: z.string(),
  status: z.enum(CHECKLIST_STATUSES),
  done: z.number().int(),
  total: z.number().int(),
  /** Open items whose due date has passed. */
  overdue: z.number().int(),
  createdAt: z.string(),
});
export type ChecklistSummary = z.infer<typeof checklistSummarySchema>;

export const checklistListSchema = z.object({
  items: z.array(checklistSummarySchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type ChecklistList = z.infer<typeof checklistListSchema>;

export const checklistDetailSchema = checklistSummarySchema.extend({
  items: z.array(checklistItemSchema),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  /** May edit items, reassign and cancel. */
  canManage: z.boolean(),
});
export type ChecklistDetail = z.infer<typeof checklistDetailSchema>;

/** An open item waiting for the caller, with the checklist it belongs to. */
export const myChecklistItemSchema = checklistItemSchema.extend({
  checklist: z.object({ id: z.uuid(), kind: z.enum(CHECKLIST_KINDS), employee: person }),
  /** Assigned to the caller (false: an HR-group item). */
  mine: z.boolean(),
});
export type MyChecklistItem = z.infer<typeof myChecklistItemSchema>;

export const myChecklistItemListSchema = z.object({ items: z.array(myChecklistItemSchema) });
export type MyChecklistItemList = z.infer<typeof myChecklistItemListSchema>;
