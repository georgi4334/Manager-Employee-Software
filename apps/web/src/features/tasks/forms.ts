import {
  MAX_TASK_DESCRIPTION,
  MAX_TASK_ESTIMATE,
  MAX_TASK_TITLE,
  PROJECT_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  type CreateTaskRequest,
  type Task,
  type UpdateTaskRequest,
} from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
export const taskFormSchema = z.object({
  projectId: z.string().min(1, { error: 'required' }),
  title: z.string().trim().min(1, { error: 'required' }).max(MAX_TASK_TITLE, { error: 'tooLong' }),
  description: z.string().trim().max(MAX_TASK_DESCRIPTION, { error: 'tooLong' }),
  type: z.enum(TASK_TYPES),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PROJECT_PRIORITIES),
  milestoneId: z.string(),
  assigneeEmployeeId: z.string(),
  estimateHours: z
    .string()
    .trim()
    .refine(
      (v) =>
        v === '' ||
        (!Number.isNaN(Number(v)) &&
          Number(v) >= 0 &&
          Number(v) <= MAX_TASK_ESTIMATE &&
          Number.isInteger(Number(v) * 2)),
      { error: 'invalidHours' },
    ),
  dueDate: z
    .string()
    .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), { error: 'invalidDate' }),
});
export type TaskFormValues = z.input<typeof taskFormSchema>;

export const emptyTask = (projectId = ''): TaskFormValues => ({
  projectId,
  title: '',
  description: '',
  type: 'functional',
  status: 'todo',
  priority: 'normal',
  milestoneId: '',
  assigneeEmployeeId: '',
  estimateHours: '',
  dueDate: '',
});

export const valuesOfTask = (t: Task): TaskFormValues => ({
  projectId: t.project.id,
  title: t.title,
  description: t.description ?? '',
  type: t.type,
  status: t.status,
  priority: t.priority,
  milestoneId: t.milestone?.id ?? '',
  assigneeEmployeeId: t.assignee?.id ?? '',
  estimateHours: t.estimateHours === null ? '' : String(t.estimateHours),
  dueDate: t.dueDate ?? '',
});

export const toCreateTask = (v: TaskFormValues): CreateTaskRequest => ({
  title: v.title.trim(),
  ...(v.description.trim() ? { description: v.description.trim() } : {}),
  type: v.type,
  status: v.status,
  priority: v.priority,
  ...(v.milestoneId ? { milestoneId: v.milestoneId } : {}),
  ...(v.assigneeEmployeeId ? { assigneeEmployeeId: v.assigneeEmployeeId } : {}),
  ...(v.estimateHours.trim() ? { estimateHours: Number(v.estimateHours) } : {}),
  ...(v.dueDate ? { dueDate: v.dueDate } : {}),
});

/** Only what changed, so saving never resends (or fights over) fields the person did not touch. */
export const toUpdateTask = (v: TaskFormValues, current: TaskFormValues): UpdateTaskRequest => {
  const body: UpdateTaskRequest = {};
  if (v.title.trim() !== current.title) body.title = v.title.trim();
  if (v.description.trim() !== current.description) {
    body.description = v.description.trim() === '' ? null : v.description.trim();
  }
  if (v.type !== current.type) body.type = v.type;
  if (v.status !== current.status) body.status = v.status;
  if (v.priority !== current.priority) body.priority = v.priority;
  if (v.milestoneId !== current.milestoneId) {
    body.milestoneId = v.milestoneId === '' ? null : v.milestoneId;
  }
  if (v.assigneeEmployeeId !== current.assigneeEmployeeId) {
    body.assigneeEmployeeId = v.assigneeEmployeeId === '' ? null : v.assigneeEmployeeId;
  }
  if (v.estimateHours.trim() !== current.estimateHours) {
    body.estimateHours = v.estimateHours.trim() === '' ? null : Number(v.estimateHours);
  }
  if (v.dueDate !== current.dueDate) body.dueDate = v.dueDate === '' ? null : v.dueDate;
  return body;
};
