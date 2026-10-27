import type { AttendeeResponse, LeaveRequest, SeriesScopeQuery } from '@intime/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRequests } from '@/features/leave/api';
import {
  calendarKeys,
  createEvent,
  deleteEvent,
  fetchEvents,
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
