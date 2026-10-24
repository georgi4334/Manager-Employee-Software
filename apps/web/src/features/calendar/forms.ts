import {
  CALENDAR_SCOPES,
  MAX_EVENT_DESCRIPTION,
  MAX_EVENT_LOCATION,
  MAX_EVENT_TITLE,
  eventShapeIssues,
  type CalendarEvent,
  type CreateEventRequest,
  type UpdateEventRequest,
} from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
const date = z
  .string()
  .min(1, { error: 'required', abort: true })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'invalidDate' });
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const eventFormSchema = z
  .object({
    scope: z.enum(CALENDAR_SCOPES),
    teamId: z.string(),
    title: z
      .string()
      .trim()
      .min(1, { error: 'required' })
      .max(MAX_EVENT_TITLE, { error: 'tooLong' }),
    description: z.string().trim().max(MAX_EVENT_DESCRIPTION, { error: 'tooLong' }),
    location: z.string().trim().max(MAX_EVENT_LOCATION, { error: 'tooLong' }),
    allDay: z.boolean(),
    startDate: date,
    endDate: date,
    startTime: z.string(),
    endTime: z.string(),
  })
  .superRefine((value, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (!value.allDay) {
      for (const field of ['startTime', 'endTime'] as const) {
        if (!value[field]) fail(field, 'required');
        else if (!TIME.test(value[field])) fail(field, 'invalidTime');
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(value.endDate))
      return;
    if (!value.allDay && (!TIME.test(value.startTime) || !TIME.test(value.endTime))) return;
    for (const issue of eventShapeIssues({
      scope: value.scope,
      teamId: value.teamId || null,
      allDay: value.allDay,
      startDate: value.startDate,
      endDate: value.endDate,
      startTime: value.allDay ? null : value.startTime,
      endTime: value.allDay ? null : value.endTime,
    })) {
      fail(issue.path, issue.code);
    }
  });
export type EventFormValues = z.input<typeof eventFormSchema>;

export const toCreateRequest = (v: EventFormValues): CreateEventRequest => ({
  scope: v.scope,
  ...(v.scope === 'team' ? { teamId: v.teamId } : {}),
  title: v.title.trim(),
  ...(v.description.trim() ? { description: v.description.trim() } : {}),
  ...(v.location.trim() ? { location: v.location.trim() } : {}),
  allDay: v.allDay,
  startDate: v.startDate,
  endDate: v.endDate,
  ...(v.allDay ? {} : { startTime: v.startTime, endTime: v.endTime }),
});

/** Scope and team never change; empty text clears the field. */
export const toUpdateRequest = (v: EventFormValues): UpdateEventRequest => ({
  title: v.title.trim(),
  description: v.description.trim() === '' ? null : v.description.trim(),
  location: v.location.trim() === '' ? null : v.location.trim(),
  allDay: v.allDay,
  startDate: v.startDate,
  endDate: v.endDate,
  startTime: v.allDay ? null : v.startTime,
  endTime: v.allDay ? null : v.endTime,
});

export const emptyEvent = (date: string): EventFormValues => ({
  scope: 'personal',
  teamId: '',
  title: '',
  description: '',
  location: '',
  allDay: false,
  startDate: date,
  endDate: date,
  startTime: '',
  endTime: '',
});

export const valuesOf = (event: CalendarEvent): EventFormValues => ({
  scope: event.scope,
  teamId: event.team?.id ?? '',
  title: event.title,
  description: event.description ?? '',
  location: event.location ?? '',
  allDay: event.allDay,
  startDate: event.startDate,
  endDate: event.endDate,
  startTime: event.startTime ?? '',
  endTime: event.endTime ?? '',
});
