import {
  DEFAULT_ONE_ON_ONE_MINUTES,
  MAX_ACTION_TITLE,
  MAX_ONE_ON_ONE_AGENDA,
  MAX_ONE_ON_ONE_MINUTES,
  MAX_ONE_ON_ONE_NOTES,
  MIN_ONE_ON_ONE_MINUTES,
  type CreateActionItemRequest,
  type CreateOneOnOneRequest,
  type OneOnOneDetail,
  type UpdateOneOnOneRequest,
} from '@intime/contracts';
import { z } from 'zod';

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isMinutes = (v: string) =>
  /^\d{1,3}$/.test(v.trim()) &&
  Number(v) >= MIN_ONE_ON_ONE_MINUTES &&
  Number(v) <= MAX_ONE_ON_ONE_MINUTES;

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
export const scheduleFormSchema = z.object({
  /** Empty = a meeting with your own manager. */
  employeeId: z.string(),
  date: z
    .string()
    .min(1, { error: 'required' })
    .refine((v) => v === '' || isDate(v), { error: 'invalidDate' }),
  time: z
    .string()
    .min(1, { error: 'required' })
    .refine((v) => v === '' || isTime(v), { error: 'invalidTime' }),
  durationMinutes: z.string().refine(isMinutes, { error: 'invalidMinutes' }),
  agenda: z.string().trim().max(MAX_ONE_ON_ONE_AGENDA, { error: 'tooLong' }),
});
export type ScheduleFormValues = z.input<typeof scheduleFormSchema>;

export const emptySchedule = (): ScheduleFormValues => ({
  employeeId: '',
  date: '',
  time: '',
  durationMinutes: String(DEFAULT_ONE_ON_ONE_MINUTES),
  agenda: '',
});

export const toCreateMeeting = (v: ScheduleFormValues): CreateOneOnOneRequest => ({
  ...(v.employeeId ? { employeeId: v.employeeId } : {}),
  date: v.date,
  time: v.time,
  durationMinutes: Number(v.durationMinutes),
  ...(v.agenda.trim() ? { agenda: v.agenda.trim() } : {}),
});

/** Moving a meeting: date, time and length. */
export const whenFormSchema = scheduleFormSchema.pick({
  date: true,
  time: true,
  durationMinutes: true,
});
export type WhenFormValues = z.input<typeof whenFormSchema>;
export const valuesOfWhen = (m: OneOnOneDetail): WhenFormValues => ({
  date: m.date,
  time: m.time,
  durationMinutes: String(m.durationMinutes),
});
export const toUpdateWhen = (v: WhenFormValues, current: WhenFormValues): UpdateOneOnOneRequest => {
  const body: UpdateOneOnOneRequest = {};
  if (v.date !== current.date || v.time !== current.time) {
    body.date = v.date;
    body.time = v.time;
  }
  if (v.durationMinutes.trim() !== current.durationMinutes) {
    body.durationMinutes = Number(v.durationMinutes);
  }
  return body;
};

const note = z.string().trim().max(MAX_ONE_ON_ONE_NOTES, { error: 'tooLong' });
export const notesFormSchema = z.object({
  agenda: z.string().trim().max(MAX_ONE_ON_ONE_AGENDA, { error: 'tooLong' }),
  sharedNotes: note,
  privateNotes: note,
});
export type NotesFormValues = z.input<typeof notesFormSchema>;
export const valuesOfNotes = (m: OneOnOneDetail): NotesFormValues => ({
  agenda: m.agenda ?? '',
  sharedNotes: m.sharedNotes ?? '',
  privateNotes: m.privateNotes ?? '',
});
/** Only the texts that changed, so saving never overwrites what the other person just wrote. */
export const toUpdateNotes = (
  v: NotesFormValues,
  current: NotesFormValues,
): UpdateOneOnOneRequest => {
  const body: UpdateOneOnOneRequest = {};
  for (const key of ['agenda', 'sharedNotes', 'privateNotes'] as const) {
    if (v[key].trim() !== current[key]) body[key] = v[key].trim() === '' ? null : v[key].trim();
  }
  return body;
};

export const actionItemFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, { error: 'required' })
    .max(MAX_ACTION_TITLE, { error: 'tooLong' }),
  /** Empty = you. */
  ownerEmployeeId: z.string(),
  dueDate: z.string().refine((v) => v === '' || isDate(v), { error: 'invalidDate' }),
});
export type ActionItemFormValues = z.input<typeof actionItemFormSchema>;
export const emptyActionItem = (): ActionItemFormValues => ({
  title: '',
  ownerEmployeeId: '',
  dueDate: '',
});
export const toCreateActionItem = (v: ActionItemFormValues): CreateActionItemRequest => ({
  title: v.title.trim(),
  ...(v.ownerEmployeeId ? { ownerEmployeeId: v.ownerEmployeeId } : {}),
  ...(v.dueDate ? { dueDate: v.dueDate } : {}),
});
