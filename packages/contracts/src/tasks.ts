import { z } from 'zod';
import { dateOnlySchema } from './employees.js';
import { PROJECT_PRIORITIES } from './projects.js';

export const TASK_TYPES = ['functional', 'non_functional'] as const;
export const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const MAX_TASK_TITLE = 120;
export const MAX_TASK_DESCRIPTION = 2000;
export const MAX_TASK_ESTIMATE = 1000;

/** The reference people use: project code and the number inside the project, e.g. WEB-12. */
export const taskKey = (code: string, number: number): string => `${code}-${number}`;

/** A task is overdue when it is not done and its due date lies before today. */
export const isOverdue = (
  task: { dueDate: string | null; status: TaskStatus },
  today: string,
): boolean => task.status !== 'done' && task.dueDate !== null && task.dueDate < today;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'tooLong' })
    .transform((value) => (value === '' ? undefined : value));
const clearable = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'tooLong' })
    .transform((value) => (value === '' ? null : value))
    .nullable();
const title = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(MAX_TASK_TITLE, { error: 'tooLong' });
const estimate = z.number().min(0).max(MAX_TASK_ESTIMATE).multipleOf(0.5);

export const createTaskRequestSchema = z
  .object({
    title,
    description: text(MAX_TASK_DESCRIPTION).optional(),
    type: z.enum(TASK_TYPES).default('functional'),
    status: z.enum(TASK_STATUSES).default('todo'),
    priority: z.enum(PROJECT_PRIORITIES).default('normal'),
    milestoneId: z.uuid().optional(),
    assigneeEmployeeId: z.uuid().optional(),
    estimateHours: estimate.optional(),
    dueDate: dateOnlySchema.optional(),
  })
  .strict();
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

/** Every field may change; people who may only move their task send just `status`. */
export const updateTaskRequestSchema = z
  .object({
    title,
    description: clearable(MAX_TASK_DESCRIPTION),
    type: z.enum(TASK_TYPES),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(PROJECT_PRIORITIES),
    milestoneId: z.uuid().nullable(),
    assigneeEmployeeId: z.uuid().nullable(),
    estimateHours: estimate.nullable(),
    dueDate: dateOnlySchema.nullable(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'required' });
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

export const taskQuerySchema = z.object({
  projectId: z.uuid().optional(),
  /** "me", "none" (unassigned) or an employee id. */
  assignee: z.union([z.literal('me'), z.literal('none'), z.uuid()]).optional(),
  status: z.enum([...TASK_STATUSES, 'all', 'open']).default('all'),
  type: z.enum([...TASK_TYPES, 'all']).default('all'),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type TaskQuery = z.infer<typeof taskQuerySchema>;

export const taskSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  number: z.number().int().min(1),
  project: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
  milestone: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  title: z.string(),
  description: z.string().nullable(),
  type: z.enum(TASK_TYPES),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PROJECT_PRIORITIES),
  assignee: z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() }).nullable(),
  estimateHours: z.number().nullable(),
  dueDate: z.string().nullable(),
  doneOn: z.string().nullable(),
  overdue: z.boolean(),
  /** May change every field. */
  canEdit: z.boolean(),
  /** May change the status (the assignee, and everybody who canEdit). */
  canMove: z.boolean(),
});
export type Task = z.infer<typeof taskSchema>;

export const taskListSchema = z.object({
  items: z.array(taskSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type TaskList = z.infer<typeof taskListSchema>;
