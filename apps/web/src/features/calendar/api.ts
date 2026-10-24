import type {
  CalendarEvent,
  CalendarEventList,
  CreateEventRequest,
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
export const updateEvent = (id: string, body: UpdateEventRequest) =>
  apiRequest<CalendarEvent>(`/calendar/events/${id}`, { method: 'PATCH', body });
export const deleteEvent = (id: string) =>
  apiRequest(`/calendar/events/${id}`, { method: 'DELETE' });
