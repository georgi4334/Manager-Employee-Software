import { z } from 'zod';
import { dateOnlySchema } from './employees.js';

export const ONE_ON_ONE_STATUSES = ['scheduled', 'done', 'cancelled'] as const;
export type OneOnOneStatus = (typeof ONE_ON_ONE_STATUSES)[number];

export const MIN_ONE_ON_ONE_MINUTES = 15;
export const MAX_ONE_ON_ONE_MINUTES = 240;
export const DEFAULT_ONE_ON_ONE_MINUTES = 30;
export const MAX_ONE_ON_ONE_AGENDA = 1000;
export const MAX_ONE_ON_ONE_NOTES = 2000;
export const MAX_ACTION_TITLE = 120;
export const MAX_ACTION_ITEMS = 20;

/** An action item is overdue when it is not done and its due date has passed (workspace time zone). */
export const isActionItemOverdue = (
  item: { dueDate: string | null; done: boolean },
  today: string,
): boolean => !item.done && item.dueDate !== null && item.dueDate < today;

// ----- requests --------------------------------------------------------------------------------

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'invalidTime' });
const duration = z
  .number()
  .int()
  .min(MIN_ONE_ON_ONE_MINUTES, { error: 'invalid' })
  .max(MAX_ONE_ON_ONE_MINUTES, { error: 'invalid' });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'tooLong' })
    .transform((v) => (v === '' ? undefined : v));
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'tooLong' })
    .transform((v) => (v === '' ? null : v))
    .nullable();

export const createOneOnOneRequestSchema = z
  .object({
    /** The report to meet; omitted = a meeting with your own manager. */
    employeeId: z.uuid().optional(),
    date: dateOnlySchema,
    time,
    durationMinutes: duration.default(DEFAULT_ONE_ON_ONE_MINUTES),
    agenda: optionalText(MAX_ONE_ON_ONE_AGENDA).optional(),
  })
  .strict();
export type CreateOneOnOneRequest = z.infer<typeof createOneOnOneRequestSchema>;

export const updateOneOnOneRequestSchema = z
  .object({
    date: dateOnlySchema,
    time,
    durationMinutes: duration,
    status: z.enum(ONE_ON_ONE_STATUSES),
    agenda: clearableText(MAX_ONE_ON_ONE_AGENDA),
    sharedNotes: clearableText(MAX_ONE_ON_ONE_NOTES),
    /** Your own private notes; the other person never sees them. */
    privateNotes: clearableText(MAX_ONE_ON_ONE_NOTES),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'required' })
  .refine((v) => (v.date === undefined) === (v.time === undefined), {
    path: ['time'],
    error: 'required',
  });
export type UpdateOneOnOneRequest = z.infer<typeof updateOneOnOneRequestSchema>;

const actionTitle = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(MAX_ACTION_TITLE, { error: 'tooLong' });

export const createActionItemRequestSchema = z
  .object({
    title: actionTitle,
    /** One of the two participants; omitted = you. */
    ownerEmployeeId: z.uuid().optional(),
    dueDate: dateOnlySchema.optional(),
  })
  .strict();
export type CreateActionItemRequest = z.infer<typeof createActionItemRequestSchema>;

export const updateActionItemRequestSchema = z
  .object({
    title: actionTitle,
    ownerEmployeeId: z.uuid(),
    dueDate: dateOnlySchema.nullable(),
    done: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'required' });
export type UpdateActionItemRequest = z.infer<typeof updateActionItemRequestSchema>;

export const oneOnOneQuerySchema = z.object({
  status: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type OneOnOneQuery = z.infer<typeof oneOnOneQuerySchema>;

// ----- responses -------------------------------------------------------------------------------

const person = z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() });

export const oneOnOneSummarySchema = z.object({
  id: z.uuid(),
  /** The other participant. */
  other: person,
  /** What the caller is in this meeting. */
  role: z.enum(['manager', 'employee']),
  date: z.string(),
  time: z.string(),
  durationMinutes: z.number().int(),
  status: z.enum(ONE_ON_ONE_STATUSES),
  openActionItems: z.number().int().min(0),
});
export type OneOnOneSummary = z.infer<typeof oneOnOneSummarySchema>;

export const actionItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  owner: person,
  dueDate: z.string().nullable(),
  done: z.boolean(),
  overdue: z.boolean(),
});
export type ActionItem = z.infer<typeof actionItemSchema>;

export const oneOnOneDetailSchema = oneOnOneSummarySchema.extend({
  manager: person,
  employee: person,
  agenda: z.string().nullable(),
  sharedNotes: z.string().nullable(),
  /** Only the caller's own private notes. */
  privateNotes: z.string().nullable(),
  actionItems: z.array(actionItemSchema),
  /** False once the meeting is cancelled. */
  canEdit: z.boolean(),
});
export type OneOnOneDetail = z.infer<typeof oneOnOneDetailSchema>;

export const oneOnOneListSchema = z.object({
  items: z.array(oneOnOneSummarySchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type OneOnOneList = z.infer<typeof oneOnOneListSchema>;

export const oneOnOnePeopleSchema = z.object({
  items: z.array(person.extend({ relation: z.enum(['manager', 'report']) })),
});
export type OneOnOnePeople = z.infer<typeof oneOnOnePeopleSchema>;
