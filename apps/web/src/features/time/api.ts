import type {
  CreateTimeEntryRequest,
  StartTimerRequest,
  TimeEntry,
  TimerResponse,
  Timesheet,
  TimesheetList,
  TimesheetQuery,
  TimeWeek,
  UpdateTimeEntryRequest,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "time" is user data: signing out removes it (see clearSession). */
export const timeKeys = {
  all: ['time'] as const,
  timer: ['time', 'timer'] as const,
  week: (weekStart: string) => ['time', 'week', weekStart] as const,
  sheets: (status: TimesheetQuery['status']) => ['time', 'sheets', status] as const,
  sheet: (id: string) => ['time', 'sheet', id] as const,
};

export const fetchTimer = () => apiRequest<TimerResponse>('/time/timer');
export const startTimer = (body: StartTimerRequest) =>
  apiRequest<TimeEntry>('/time/timer/start', { method: 'POST', body });
export const stopTimer = () => apiRequest<TimeEntry>('/time/timer/stop', { method: 'POST' });

export const fetchWeek = (weekStart: string) =>
  apiRequest<TimeWeek>(`/time/week?${new URLSearchParams({ weekStart })}`);
export const createEntry = (body: CreateTimeEntryRequest) =>
  apiRequest<TimeEntry>('/time/entries', { method: 'POST', body });
export const updateEntry = (id: string, body: UpdateTimeEntryRequest) =>
  apiRequest<TimeEntry>(`/time/entries/${id}`, { method: 'PATCH', body });
export const deleteEntry = (id: string) => apiRequest(`/time/entries/${id}`, { method: 'DELETE' });

export const submitWeek = (weekStart: string) =>
  apiRequest<Timesheet>('/time/timesheets/submit', { method: 'POST', body: { weekStart } });
export const fetchTimesheets = (status: TimesheetQuery['status']) =>
  apiRequest<TimesheetList>(`/time/timesheets?${new URLSearchParams({ status, pageSize: '50' })}`);
export const fetchTimesheet = (id: string) => apiRequest<TimeWeek>(`/time/timesheets/${id}`);
export const decideTimesheet = (id: string, action: 'approve' | 'reject' | 'reopen') =>
  apiRequest<Timesheet>(`/time/timesheets/${id}/${action}`, { method: 'POST' });
