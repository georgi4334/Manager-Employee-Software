import type {
  AttendanceRecord,
  AttendanceRecordList,
  AttendanceStatus,
  CheckInRequest,
  CheckOutRequest,
  CreateRecordRequest,
  Presence,
  UpdateRecordRequest,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "attendance" is user data: signing out removes it (see clearSession). */
export const attendanceKeys = {
  all: ['attendance'] as const,
  status: ['attendance', 'status'] as const,
  presence: ['attendance', 'presence'] as const,
  records: (params: RecordParams) => ['attendance', 'records', params] as const,
};

export interface RecordParams {
  employeeId?: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
}

export const fetchStatus = () => apiRequest<AttendanceStatus>('/attendance/status');
export const fetchPresence = () => apiRequest<Presence>('/attendance/today');
export const fetchRecords = (params: RecordParams) => {
  const query = new URLSearchParams({
    from: params.from,
    to: params.to,
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.employeeId) query.set('employeeId', params.employeeId);
  return apiRequest<AttendanceRecordList>(`/attendance/records?${query}`);
};
export const checkIn = (body: CheckInRequest) =>
  apiRequest<AttendanceRecord>('/attendance/check-in', { method: 'POST', body });
export const checkOut = (body: CheckOutRequest) =>
  apiRequest<AttendanceRecord>('/attendance/check-out', { method: 'POST', body });
export const createRecord = (body: CreateRecordRequest) =>
  apiRequest<AttendanceRecord>('/attendance/records', { method: 'POST', body });
export const updateRecord = (id: string, body: UpdateRecordRequest) =>
  apiRequest<AttendanceRecord>(`/attendance/records/${id}`, { method: 'PATCH', body });
export const deleteRecord = (id: string) =>
  apiRequest(`/attendance/records/${id}`, { method: 'DELETE' });
