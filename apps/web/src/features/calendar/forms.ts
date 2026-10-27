import {
  CALENDAR_SCOPES,
  MAX_ATTENDEES,
  MAX_EVENT_DESCRIPTION,
  MAX_EVENT_LOCATION,
  MAX_EVENT_TITLE,
  MAX_RECURRENCE_COUNT,
  MAX_RECURRENCE_INTERVAL,
  RECURRENCE_FREQS,
  eventShapeIssues,
  type CalendarEvent,
  type CreateEventRequest,
  type RecurrenceRequest,
  type UpdateEventRequest,
} from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
const date = z
  .string()
  .min(1, { error: 'required', abort: true })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'invalidDate' });
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const wholeNumber = (text: string, min: number, max: number): boolean =>
  /^\d{1,4}$/.test(text.trim()) && Number(text) >= min && Number(text) <= max;

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
    repeat: z.enum(['none', ...RECURRENCE_FREQS]),
    interval: z.string(),
    weekdays: z.array(z.number().int().min(0).max(6)),
    ends: z.enum(['never', 'until', 'count']),
    until: z.string(),
    count: z.string(),
    attendeeIds: z.array(z.string()).max(MAX_ATTENDEES, { error: 'tooMany' }),
  })
  .superRefine((value, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (value.repeat !== 'none') {
      if (!wholeNumber(value.interval, 1, MAX_RECURRENCE_INTERVAL))
        fail('interval', 'invalidInterval');
      if (value.ends === 'count' && !wholeNumber(value.count, 1, MAX_RECURRENCE_COUNT)) {
        fail('count', 'invalidCount');
      }
      if (value.ends === 'until') {
        if (!value.until) fail('until', 'required');
        else if (!/^\d{4}-\d{2}-\d{2}$/.test(value.until)) fail('until', 'invalidDate');
        else if (value.until < value.startDate) fail('until', 'end_before_start');
      }
    }
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

/** The repeat rule the form describes; `null` when the event does not repeat. */
export function recurrenceOf(v: EventFormValues): RecurrenceRequest | null {
  if (v.repeat === 'none') return null;
  return {
    freq: v.repeat,
    interval: Number(v.interval),
    weekdays: v.repeat === 'weekly' ? [...v.weekdays].sort((a, b) => a - b) : [],
    until: v.ends === 'until' ? v.until : null,
    count: v.ends === 'count' ? Number(v.count) : null,
  };
}

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
  ...(v.repeat === 'none' ? {} : { recurrence: recurrenceOf(v) ?? undefined }),
  ...(v.scope === 'personal' && v.attendeeIds.length > 0 ? { attendeeIds: v.attendeeIds } : {}),
});

const sameRule = (a: RecurrenceRequest | null, b: CalendarEvent['recurrence']): boolean =>
  a === null || b === null
    ? a === b
    : a.freq === b.freq &&
      a.interval === b.interval &&
      a.until === b.until &&
      a.count === b.count &&
      a.weekdays.join() === [...b.weekdays].sort((x, y) => x - y).join();

/**
 * Scope and team never change; empty text clears the field. The repeat rule and the guest list go
 * along only when they changed (so an untouched series keeps its guests' answers), and only for
 * the organizer; editing a single occurrence never changes the rule.
 */
export const toUpdateRequest = (
  v: EventFormValues,
  event: CalendarEvent,
  mode: 'all' | 'this' | 'following' = 'all',
): UpdateEventRequest => {
  const rule = recurrenceOf(v);
  const guests = [...v.attendeeIds].sort();
  const before = event.attendees.map((a) => a.employee.id).sort();
  return {
    title: v.title.trim(),
    description: v.description.trim() === '' ? null : v.description.trim(),
    location: v.location.trim() === '' ? null : v.location.trim(),
    allDay: v.allDay,
    startDate: v.startDate,
    endDate: v.endDate,
    startTime: v.allDay ? null : v.startTime,
    endTime: v.allDay ? null : v.endTime,
    ...(mode !== 'this' && !sameRule(rule, event.recurrence) ? { recurrence: rule } : {}),
    ...(event.isOrganizer && event.scope === 'personal' && guests.join() !== before.join()
      ? { attendeeIds: guests }
      : {}),
  };
};

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
  repeat: 'none',
  interval: '1',
  weekdays: [],
  ends: 'never',
  until: '',
  count: '',
  attendeeIds: [],
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
  repeat: event.recurrence?.freq ?? 'none',
  interval: String(event.recurrence?.interval ?? 1),
  weekdays: [...(event.recurrence?.weekdays ?? [])],
  ends: event.recurrence?.until ? 'until' : event.recurrence?.count ? 'count' : 'never',
  until: event.recurrence?.until ?? '',
  count: event.recurrence?.count ? String(event.recurrence.count) : '',
  attendeeIds: event.attendees.map((a) => a.employee.id),
});
