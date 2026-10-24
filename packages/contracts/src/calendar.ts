import { z } from 'zod';
import { daysBetween } from './dates.js';
import { dateOnlySchema } from './employees.js';

export const CALENDAR_SCOPES = ['personal', 'team', 'company'] as const;
export type CalendarScope = (typeof CALENDAR_SCOPES)[number];

export const MAX_EVENT_TITLE = 120;
export const MAX_EVENT_DESCRIPTION = 1000;
export const MAX_EVENT_LOCATION = 200;
/** Longest event in days (end date inclusive). */
export const MAX_EVENT_DAYS = 31;
export const MAX_CALENDAR_RANGE_DAYS = 93;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'invalidTime' });
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'tooLong' })
    .transform((value) => (value === '' ? undefined : value));
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'tooLong' })
    .transform((value) => (value === '' ? null : value))
    .nullable();

export interface EventShape {
  scope: CalendarScope;
  teamId?: string | null;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
}

export interface ShapeIssue {
  path: 'teamId' | 'startTime' | 'endTime' | 'endDate';
  code: string;
}

/** Cross-field rules shared by the API and the web form (the database repeats the structural ones). */
export function eventShapeIssues(shape: EventShape): ShapeIssue[] {
  const issues: ShapeIssue[] = [];
  if (shape.scope === 'team' && !shape.teamId) issues.push({ path: 'teamId', code: 'required' });
  if (shape.scope !== 'team' && shape.teamId)
    issues.push({ path: 'teamId', code: 'team_not_allowed' });
  if (shape.endDate < shape.startDate) {
    issues.push({ path: 'endDate', code: 'end_before_start' });
  } else if (daysBetween(shape.startDate, shape.endDate) + 1 > MAX_EVENT_DAYS) {
    issues.push({ path: 'endDate', code: 'too_long' });
  }
  if (shape.allDay) {
    if (shape.startTime) issues.push({ path: 'startTime', code: 'time_not_allowed' });
    if (shape.endTime) issues.push({ path: 'endTime', code: 'time_not_allowed' });
  } else {
    if (!shape.startTime) issues.push({ path: 'startTime', code: 'required' });
    if (!shape.endTime) issues.push({ path: 'endTime', code: 'required' });
    if (
      shape.startTime &&
      shape.endTime &&
      shape.startDate === shape.endDate &&
      shape.endTime <= shape.startTime
    ) {
      issues.push({ path: 'endTime', code: 'end_before_start' });
    }
  }
  return issues;
}

export const createEventRequestSchema = z
  .object({
    scope: z.enum(CALENDAR_SCOPES),
    /** Only for team events. */
    teamId: z.uuid().optional(),
    title: z
      .string()
      .trim()
      .min(1, { error: 'required' })
      .max(MAX_EVENT_TITLE, { error: 'tooLong' }),
    description: text(MAX_EVENT_DESCRIPTION).optional(),
    location: text(MAX_EVENT_LOCATION).optional(),
    allDay: z.boolean(),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    startTime: time.optional(),
    endTime: time.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const issue of eventShapeIssues(value)) {
      ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.code });
    }
  });
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;

/** The scope and team of an event never change; times of an all-day event are cleared with `null`. */
export const updateEventRequestSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, { error: 'required' })
      .max(MAX_EVENT_TITLE, { error: 'tooLong' }),
    description: clearableText(MAX_EVENT_DESCRIPTION),
    location: clearableText(MAX_EVENT_LOCATION),
    allDay: z.boolean(),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    startTime: time.nullable(),
    endTime: time.nullable(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'required' });
export type UpdateEventRequest = z.infer<typeof updateEventRequestSchema>;

export const eventQuerySchema = z
  .object({ from: dateOnlySchema, to: dateOnlySchema })
  .refine((value) => value.to >= value.from, { path: ['to'], error: 'end_before_start' })
  .refine((value) => daysBetween(value.from, value.to) + 1 <= MAX_CALENDAR_RANGE_DAYS, {
    path: ['to'],
    error: 'too_long',
  });
export type EventQuery = z.infer<typeof eventQuerySchema>;

export const calendarEventSchema = z.object({
  id: z.uuid(),
  scope: z.enum(CALENDAR_SCOPES),
  team: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  owner: z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() }),
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  allDay: z.boolean(),
  startDate: z.string(),
  endDate: z.string(),
  /** Local "HH:MM" in the workspace time zone; null for all-day events. */
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  canEdit: z.boolean(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const calendarEventListSchema = z.object({ items: z.array(calendarEventSchema) });
export type CalendarEventList = z.infer<typeof calendarEventListSchema>;
