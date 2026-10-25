import type { LeaveRequest } from '@intime/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adjustBalance,
  createHoliday,
  createRequest,
  createType,
  decideRequest,
  deleteHoliday,
  fetchBalances,
  fetchHolidays,
  fetchConflicts,
  fetchRequests,
  fetchSettings,
  fetchTypes,
  leaveKeys,
  previewRequest,
  updateSettings,
  updateType,
  type RequestParams,
} from './api';

export const useLeaveTypes = () =>
  useQuery({ queryKey: leaveKeys.types, queryFn: fetchTypes, retry: false });

export const useLeaveSettings = () =>
  useQuery({ queryKey: leaveKeys.settings, queryFn: fetchSettings, retry: false });

export const useBalances = (employeeId: string | undefined, year: number, enabled = true) =>
  useQuery({
    queryKey: leaveKeys.balances(employeeId, year),
    queryFn: () => fetchBalances(employeeId, year),
    enabled,
    retry: false,
  });

export const useLeaveRequests = (params: RequestParams, enabled = true) =>
  useQuery({
    queryKey: leaveKeys.requests(params),
    queryFn: () => fetchRequests(params),
    placeholderData: keepPreviousData,
    enabled,
    retry: false,
  });

export const useHolidays = (year: number, country: string) =>
  useQuery({
    queryKey: leaveKeys.holidays(year, country),
    queryFn: () => fetchHolidays(year, country),
    retry: false,
  });

/** Requests change balances and pending approvals everywhere, so everything under "leave" is refreshed. */
function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: leaveKeys.all });
}

export function useCreateRequest() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: createRequest, onSuccess: refresh });
}

export function useDecideRequest(action: 'approve' | 'reject' | 'cancel') {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ request, comment }: { request: LeaveRequest; comment?: string }) =>
      decideRequest(request.id, action, comment ? { comment } : {}),
    onSuccess: refresh,
  });
}

export function usePreviewRequest() {
  return useMutation({ mutationFn: previewRequest });
}

export function useCreateType() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: createType, onSuccess: refresh });
}

export function useUpdateType(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof updateType>[1]) => updateType(id, body),
    onSuccess: refresh,
  });
}

export function useUpdateSettings() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: updateSettings, onSuccess: refresh });
}

export function useCreateHoliday() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: createHoliday, onSuccess: refresh });
}

export function useDeleteHoliday() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: deleteHoliday, onSuccess: refresh });
}

export function useAdjustBalance() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: adjustBalance, onSuccess: refresh });
}

/** What a request collides with (projects, milestones, tasks); fetched only when the approver asks. */
export const useLeaveConflicts = (requestId: string, enabled: boolean) =>
  useQuery({
    queryKey: leaveKeys.conflicts(requestId),
    queryFn: () => fetchConflicts(requestId),
    enabled,
    retry: false,
  });
