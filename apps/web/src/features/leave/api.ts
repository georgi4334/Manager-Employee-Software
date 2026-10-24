import type {
  AdjustBalanceRequest,
  CreateHolidayRequest,
  CreateLeaveRequest,
  CreateLeaveTypeRequest,
  DecisionRequest,
  Holiday,
  LeaveBalance,
  LeaveBalances,
  LeavePreview,
  LeaveRequest,
  LeaveRequestList,
  LeaveSettings,
  LeaveType,
  PreviewLeaveRequest,
  UpdateLeaveSettingsRequest,
  UpdateLeaveTypeRequest,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "leave" is user data: signing out removes it (see clearSession). */
export const leaveKeys = {
  all: ['leave'] as const,
  types: ['leave', 'types'] as const,
  settings: ['leave', 'settings'] as const,
  balances: (employeeId: string | undefined, year: number) =>
    ['leave', 'balances', employeeId ?? 'me', year] as const,
  requests: (params: RequestParams) => ['leave', 'requests', params] as const,
  holidays: (year: number, country: string) => ['leave', 'holidays', year, country] as const,
};

export interface RequestParams {
  employeeId?: string;
  status?: LeaveRequest['status'];
  from?: string;
  to?: string;
  approvable?: boolean;
  page: number;
  pageSize: number;
}

export const fetchTypes = () => apiRequest<LeaveType[]>('/leave/types');
export const createType = (body: CreateLeaveTypeRequest) =>
  apiRequest<LeaveType>('/leave/types', { method: 'POST', body });
export const updateType = (id: string, body: UpdateLeaveTypeRequest) =>
  apiRequest<LeaveType>(`/leave/types/${id}`, { method: 'PATCH', body });

export const fetchSettings = () => apiRequest<LeaveSettings>('/leave/settings');
export const updateSettings = (body: UpdateLeaveSettingsRequest) =>
  apiRequest<LeaveSettings>('/leave/settings', { method: 'PUT', body });

export const fetchBalances = (employeeId: string | undefined, year: number) => {
  const query = new URLSearchParams({ year: String(year) });
  if (employeeId) query.set('employeeId', employeeId);
  return apiRequest<LeaveBalances>(`/leave/balances?${query}`);
};
export const adjustBalance = (body: AdjustBalanceRequest) =>
  apiRequest<LeaveBalance>('/leave/balances/adjustments', { method: 'POST', body });

export const fetchRequests = (params: RequestParams) => {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.employeeId) query.set('employeeId', params.employeeId);
  if (params.status) query.set('status', params.status);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.approvable) query.set('approvable', 'true');
  return apiRequest<LeaveRequestList>(`/leave/requests?${query}`);
};
export const previewRequest = (body: PreviewLeaveRequest) =>
  apiRequest<LeavePreview>('/leave/requests/preview', { method: 'POST', body });
export const createRequest = (body: CreateLeaveRequest) =>
  apiRequest<LeaveRequest>('/leave/requests', { method: 'POST', body });
export const decideRequest = (
  id: string,
  action: 'approve' | 'reject' | 'cancel',
  body: DecisionRequest,
) => apiRequest<LeaveRequest>(`/leave/requests/${id}/${action}`, { method: 'POST', body });

export const fetchHolidays = (year: number, country: string) => {
  const query = new URLSearchParams({ year: String(year) });
  if (country) query.set('country', country);
  return apiRequest<Holiday[]>(`/leave/holidays?${query}`);
};
export const createHoliday = (body: CreateHolidayRequest) =>
  apiRequest<Holiday>('/leave/holidays', { method: 'POST', body });
export const deleteHoliday = (id: string) =>
  apiRequest(`/leave/holidays/${id}`, { method: 'DELETE' });
