import {
  PUBLIC_HOLIDAY_LANGUAGES,
  type AttendeeResponse,
  type LeaveRequest,
  type PublicHolidayLanguage,
  type SeriesScopeQuery,
} from '@intime/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRequests } from '@/features/leave/api';
import {
  calendarKeys,
  createEvent,
  deleteEvent,
  fetchEvents,
  fetchPublicHolidays,
  findTime,
  respondToEvent,
  updateEvent,
} from './api';

const LEAVE_PAGE_SIZE = 100;
const LEAVE_MAX_PAGES = 5;

export const useEvents = (from: string, to: string) =>
  useQuery({
    queryKey: calendarKeys.events(from, to),
    queryFn: () => fetchEvents(from, to),
    placeholderData: keepPreviousData,
    retry: false,
  });

const HOLIDAY_STALE_MS = 60 * 60 * 1000;

/** The feed has names in these languages; anything else asks for English. */
export const holidayLanguage = (language: string): PublicHolidayLanguage =>
  PUBLIC_HOLIDAY_LANGUAGES.find((l) => l === language.slice(0, 2)) ?? 'en';

/** Public holidays of Bulgaria, Germany and England; a failure only hides the layer, never the page. */
export const usePublicHolidays = (from: string, to: string, language: string, enabled: boolean) =>
  useQuery({
    queryKey: [
      ...calendarKeys.all,
      'public-holidays',
      from,
      to,
      holidayLanguage(language),
    ] as const,
    queryFn: () => fetchPublicHolidays(from, to, holidayLanguage(language)),
    placeholderData: keepPreviousData,
    staleTime: HOLIDAY_STALE_MS,
    retry: false,
    enabled,
  });

/** Approved and pending leave in the period for the people the caller may see (the server masks and scopes it). */
export const useLeaveLayer = (from: string, to: string, enabled: boolean) =>
  useQuery({
    // Under "leave", so every leave change refreshes it.
    queryKey: ['leave', 'calendar', from, to] as const,
    queryFn: async (): Promise<LeaveRequest[]> => {
      const all: LeaveRequest[] = [];
      for (let page = 1; page <= LEAVE_MAX_PAGES; page++) {
        const result = await fetchRequests({ from, to, page, pageSize: LEAVE_PAGE_SIZE });
        all.push(...result.items);
        if (all.length >= result.total) break;
      }
      return all.filter((r) => r.status === 'approved' || r.status === 'pending');
    },
    placeholderData: keepPreviousData,
    enabled,
    retry: false,
  });

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: calendarKeys.all });
}

export function useCreateEvent() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: createEvent, onSuccess: refresh });
}

export function useUpdateEvent(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({
      body,
      scope,
    }: {
      body: Parameters<typeof updateEvent>[1];
      scope?: SeriesScopeQuery;
    }) => updateEvent(id, body, scope),
    onSuccess: refresh,
  });
}

export function useDeleteEvent() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, scope }: { id: string; scope?: SeriesScopeQuery }) => deleteEvent(id, scope),
    onSuccess: refresh,
  });
}

export function useRespond(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (response: Exclude<AttendeeResponse, 'needs_action'>) =>
      respondToEvent(id, response),
    onSuccess: refresh,
  });
}

export const useFindTime = () => useMutation({ mutationFn: findTime });
