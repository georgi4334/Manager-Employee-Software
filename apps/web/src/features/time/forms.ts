import {
  MAX_TIME_NOTE,
  formatDuration,
  parseDuration,
  type CreateTimeEntryRequest,
  type StartTimerRequest,
  type TimeEntry,
  type UpdateTimeEntryRequest,
} from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
const note = z.string().trim().max(MAX_TIME_NOTE, { error: 'tooLong' });

export const timerFormSchema = z.object({
  projectId: z.string().min(1, { error: 'required' }),
  taskId: z.string(),
  note,
});
export type TimerFormValues = z.input<typeof timerFormSchema>;

export const toStartTimer = (v: TimerFormValues): StartTimerRequest => ({
  projectId: v.projectId,
  ...(v.taskId ? { taskId: v.taskId } : {}),
  ...(v.note.trim() ? { note: v.note.trim() } : {}),
});

export const entryFormSchema = z.object({
  projectId: z.string().min(1, { error: 'required' }),
  taskId: z.string(),
  workDate: z
    .string()
    .min(1, { error: 'required', abort: true })
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'invalidDate' }),
  duration: z
    .string()
    .trim()
    .min(1, { error: 'required', abort: true })
    .refine((v) => parseDuration(v) !== null, { error: 'invalidDuration' }),
  note,
  isBillable: z.boolean(),
});
export type EntryFormValues = z.input<typeof entryFormSchema>;

export const emptyEntry = (workDate: string): EntryFormValues => ({
  projectId: '',
  taskId: '',
  workDate,
  duration: '',
  note: '',
  isBillable: true,
});

export const valuesOfEntry = (e: TimeEntry): EntryFormValues => ({
  projectId: e.project.id,
  taskId: e.task?.id ?? '',
  workDate: e.workDate,
  duration: formatDuration(e.minutes ?? 0),
  note: e.note ?? '',
  isBillable: e.isBillable,
});

export const toCreateEntry = (v: EntryFormValues): CreateTimeEntryRequest => ({
  projectId: v.projectId,
  ...(v.taskId ? { taskId: v.taskId } : {}),
  workDate: v.workDate,
  minutes: parseDuration(v.duration)!,
  isBillable: v.isBillable,
  ...(v.note.trim() ? { note: v.note.trim() } : {}),
});

/** Only what changed, so saving never resends fields the person did not touch. */
export const toUpdateEntry = (
  v: EntryFormValues,
  current: EntryFormValues,
): UpdateTimeEntryRequest => {
  const body: UpdateTimeEntryRequest = {};
  if (v.projectId !== current.projectId) body.projectId = v.projectId;
  if (v.taskId !== current.taskId) body.taskId = v.taskId === '' ? null : v.taskId;
  if (v.workDate !== current.workDate) body.workDate = v.workDate;
  const minutes = parseDuration(v.duration);
  if (minutes !== null && minutes !== parseDuration(current.duration)) body.minutes = minutes;
  if (v.isBillable !== current.isBillable) body.isBillable = v.isBillable;
  if (v.note.trim() !== current.note) body.note = v.note.trim() === '' ? null : v.note.trim();
  return body;
};
