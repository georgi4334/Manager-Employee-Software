import type {
  AttendeeResponse,
  CalendarEvent,
  CalendarEventList,
  CreateEventRequest,
  FindTimeRequest,
  FindTimeResponse,
  SeriesScopeQuery,
  UpdateEventRequest,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "calendar" is user data: signing out removes it (see clearSession). */
export const calendarKeys = {
  all: ['calendar'] as const,
  events: (from: string, to: string) => ['calendar', 'events', from, to] as const,
};

export const fetchEvents = (from: string, to: string) =>
  apiRequest<CalendarEventList>(`/calendar/events?${new URLSearchParams({ from, to })}`);
export const createEvent = (body: CreateEventRequest) =>
  apiRequest<CalendarEvent>('/calendar/events', { method: 'POST', body });

/** `all` is the server's default, so it is not sent. */
const scopeQuery = (scope: SeriesScopeQuery | undefined): string =>
  scope && scope.mode !== 'all'
    ? `?${new URLSearchParams({ mode: scope.mode, occurrence: scope.occurrence ?? '' })}`
    : '';

export const updateEvent = (id: string, body: UpdateEventRequest, scope?: SeriesScopeQuery) =>
  apiRequest<CalendarEvent>(`/calendar/events/${id}${scopeQuery(scope)}`, {
    method: 'PATCH',
    body,
  });
export const deleteEvent = (id: string, scope?: SeriesScopeQuery) =>
  apiRequest(`/calendar/events/${id}${scopeQuery(scope)}`, { method: 'DELETE' });
export const respondToEvent = (id: string, response: Exclude<AttendeeResponse, 'needs_action'>) =>
  apiRequest<CalendarEvent>(`/calendar/events/${id}/response`, {
    method: 'PUT',
    body: { response },
  });
export const findTime = (body: FindTimeRequest) =>
  apiRequest<FindTimeResponse>('/calendar/find-time', { method: 'POST', body });
