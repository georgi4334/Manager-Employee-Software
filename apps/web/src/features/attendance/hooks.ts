import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  attendanceKeys,
  checkIn,
  checkOut,
  createRecord,
  deleteRecord,
  fetchPresence,
  fetchRecords,
  fetchStatus,
  updateRecord,
  type RecordParams,
} from './api';

export const useAttendanceStatus = (enabled = true) =>
  useQuery({ queryKey: attendanceKeys.status, queryFn: fetchStatus, enabled, retry: false });

export const usePresence = (enabled = true) =>
  useQuery({ queryKey: attendanceKeys.presence, queryFn: fetchPresence, enabled, retry: false });

export const useRecords = (params: RecordParams, enabled = true) =>
  useQuery({
    queryKey: attendanceKeys.records(params),
    queryFn: () => fetchRecords(params),
    placeholderData: keepPreviousData,
    enabled,
    retry: false,
  });

/** A change moves today's status, the team view and every list, so everything under "attendance" is refreshed. */
function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: attendanceKeys.all });
}

export function useCheckIn() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: checkIn, onSuccess: refresh });
}

export function useCheckOut() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: checkOut, onSuccess: refresh });
}

export function useCreateRecord() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: createRecord, onSuccess: refresh });
}

export function useUpdateRecord(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof updateRecord>[1]) => updateRecord(id, body),
    onSuccess: refresh,
  });
}

export function useDeleteRecord() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: deleteRecord, onSuccess: refresh });
}
