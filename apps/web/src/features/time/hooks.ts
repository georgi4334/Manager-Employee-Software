import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TimesheetQuery } from '@intime/contracts';
import {
  createEntry,
  decideTimesheet,
  deleteEntry,
  fetchTimer,
  fetchTimesheet,
  fetchTimesheets,
  fetchWeek,
  startTimer,
  stopTimer,
  submitWeek,
  timeKeys,
  updateEntry,
} from './api';

export const useTimer = (enabled = true) =>
  useQuery({ queryKey: timeKeys.timer, queryFn: fetchTimer, enabled, retry: false });

export const useWeek = (weekStart: string) =>
  useQuery({
    queryKey: timeKeys.week(weekStart),
    queryFn: () => fetchWeek(weekStart),
    retry: false,
  });

export const useTimesheets = (status: TimesheetQuery['status'], enabled = true) =>
  useQuery({
    queryKey: timeKeys.sheets(status),
    queryFn: () => fetchTimesheets(status),
    enabled,
    retry: false,
  });

export const useTimesheetDetail = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: timeKeys.sheet(id),
    queryFn: () => fetchTimesheet(id),
    enabled,
    retry: false,
  });

/** Timer, entries, weeks and sheets depend on each other: refresh all of "time" after any change. */
function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: timeKeys.all });
}

export function useStartTimer() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: startTimer, onSuccess: refresh });
}
export function useStopTimer() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: stopTimer, onSuccess: refresh });
}
export function useCreateEntry() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: createEntry, onSuccess: refresh });
}
export function useUpdateEntry(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof updateEntry>[1]) => updateEntry(id, body),
    onSuccess: refresh,
  });
}
export function useDeleteEntry() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: deleteEntry, onSuccess: refresh });
}
export function useSubmitWeek() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: submitWeek, onSuccess: refresh });
}
export function useDecideTimesheet() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' | 'reopen' }) =>
      decideTimesheet(id, action),
    onSuccess: refresh,
  });
}
