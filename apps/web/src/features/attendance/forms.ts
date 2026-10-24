import {
  ATTENDANCE_MODES,
  MAX_ATTENDANCE_NOTE,
  type AttendanceRecord,
  type CreateRecordRequest,
  type UpdateRecordRequest,
} from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
const date = z
  .string()
  .min(1, { error: 'required', abort: true })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'invalidDate' });
const time = z
  .string()
  .min(1, { error: 'required', abort: true })
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'invalidTime' });

export const recordFormSchema = z
  .object({
    /** Empty = yourself. */
    employeeId: z.string(),
    date,
    startTime: time,
    endTime: time,
    mode: z.enum(ATTENDANCE_MODES),
    note: z.string().trim().max(MAX_ATTENDANCE_NOTE, { error: 'tooLong' }),
  })
  .superRefine((value, ctx) => {
    if (value.endTime > value.startTime || !/^\d\d:\d\d$/.test(value.endTime)) return;
    if (/^\d\d:\d\d$/.test(value.startTime)) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'end_before_start' });
    }
  });
export type RecordFormValues = z.input<typeof recordFormSchema>;

/** An open record only has a mode and a note; the clock sets the times. */
export const openRecordFormSchema = z.object({
  mode: z.enum(ATTENDANCE_MODES),
  note: z.string().trim().max(MAX_ATTENDANCE_NOTE, { error: 'tooLong' }),
});
export type OpenRecordFormValues = z.input<typeof openRecordFormSchema>;

export const toCreateRequest = (v: RecordFormValues): CreateRecordRequest => ({
  ...(v.employeeId ? { employeeId: v.employeeId } : {}),
  date: v.date,
  startTime: v.startTime,
  endTime: v.endTime,
  mode: v.mode,
  ...(v.note.trim() ? { note: v.note.trim() } : {}),
});

export const toUpdateRequest = (v: RecordFormValues): UpdateRecordRequest => ({
  date: v.date,
  startTime: v.startTime,
  endTime: v.endTime,
  mode: v.mode,
  note: v.note.trim() === '' ? null : v.note.trim(),
});

export const toOpenUpdate = (v: OpenRecordFormValues): UpdateRecordRequest => ({
  mode: v.mode,
  note: v.note.trim() === '' ? null : v.note.trim(),
});

export const valuesOf = (record: AttendanceRecord): RecordFormValues => ({
  employeeId: '',
  date: record.date,
  startTime: record.startTime,
  endTime: record.endTime ?? '',
  mode: record.mode,
  note: record.note ?? '',
});
