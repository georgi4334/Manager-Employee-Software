import { z } from 'zod';
import { dateOnlySchema } from './employees.js';

export const ATTENDANCE_MODES = ['office', 'remote', 'field'] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

export const ATTENDANCE_SOURCES = ['clock', 'entry', 'correction'] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

export const MAX_ATTENDANCE_MINUTES = 16 * 60;
/** How many days back people may type in or change their own records. */
export const ATTENDANCE_SELF_EDIT_DAYS = 7;
export const MAX_ATTENDANCE_RANGE_DAYS = 93;
export const MAX_ATTENDANCE_NOTE = 200;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'invalidTime' });
const note = z
  .string()
  .trim()
  .max(MAX_ATTENDANCE_NOTE, { error: 'tooLong' })
  .transform((value) => (value === '' ? undefined : value));
const mode = z.enum(ATTENDANCE_MODES);

export const checkInRequestSchema = z.object({ mode, note: note.optional() }).strict();
export type CheckInRequest = z.infer<typeof checkInRequestSchema>;

export const checkOutRequestSchema = z
  .object({ at: z.iso.datetime({ offset: true }).optional() })
  .strict();
export type CheckOutRequest = z.infer<typeof checkOutRequestSchema>;

export const createRecordRequestSchema = z
  .object({
    /** Omitted = yourself. */
    employeeId: z.uuid().optional(),
    date: dateOnlySchema,
    startTime: time,
    endTime: time,
    mode,
    note: note.optional(),
  })
  .strict()
  .refine((value) => value.endTime > value.startTime, {
    path: ['endTime'],
    error: 'end_before_start',
  });
export type CreateRecordRequest = z.infer<typeof createRecordRequestSchema>;

export const updateRecordRequestSchema = z
  .object({
    date: dateOnlySchema,
    startTime: time,
    endTime: time,
    mode,
    /** null clears the note. */
    note: z
      .string()
      .trim()
      .max(MAX_ATTENDANCE_NOTE, { error: 'tooLong' })
      .transform((value) => (value === '' ? null : value))
      .nullable(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'required' });
export type UpdateRecordRequest = z.infer<typeof updateRecordRequestSchema>;

export const recordQuerySchema = z
  .object({
    employeeId: z.uuid().optional(),
    from: dateOnlySchema,
    to: dateOnlySchema,
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(100),
  })
  .refine((value) => value.to >= value.from, { path: ['to'], error: 'end_before_start' });
export type RecordQuery = z.infer<typeof recordQuerySchema>;

const person = z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() });

export const attendanceRecordSchema = z.object({
  id: z.uuid(),
  employee: person,
  date: z.string(),
  startTime: z.string(),
  endTime: z.string().nullable(),
  checkInAt: z.string(),
  checkOutAt: z.string().nullable(),
  /** null while the record is open. */
  minutes: z.number().int().nullable(),
  mode: z.enum(ATTENDANCE_MODES),
  note: z.string().nullable(),
  source: z.enum(ATTENDANCE_SOURCES),
  open: z.boolean(),
  canEdit: z.boolean(),
});
export type AttendanceRecord = z.infer<typeof attendanceRecordSchema>;

export const attendanceRecordListSchema = z.object({
  items: z.array(attendanceRecordSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type AttendanceRecordList = z.infer<typeof attendanceRecordListSchema>;

export const attendanceStatusSchema = z.object({
  /** Today's date in the workspace time zone. */
  today: z.string(),
  open: attendanceRecordSchema.nullable(),
  records: z.array(attendanceRecordSchema),
  /** Minutes of finished records today (an open record is not counted). */
  minutes: z.number().int().min(0),
});
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

export const PRESENCE_STATES = ['working', 'done', 'leave', 'none'] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

export const presenceItemSchema = z.object({
  employee: person,
  state: z.enum(PRESENCE_STATES),
  mode: z.enum(ATTENDANCE_MODES).nullable(),
  /** Local "HH:MM" of the current check-in while working. */
  since: z.string().nullable(),
  minutes: z.number().int().min(0),
});
export type PresenceItem = z.infer<typeof presenceItemSchema>;

export const presenceSchema = z.object({ date: z.string(), items: z.array(presenceItemSchema) });
export type Presence = z.infer<typeof presenceSchema>;
