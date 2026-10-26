import type {
  CreateActionItemRequest,
  CreateOneOnOneRequest,
  OneOnOneDetail,
  OneOnOneList,
  OneOnOnePeople,
  OneOnOneQuery,
  UpdateActionItemRequest,
  UpdateOneOnOneRequest,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "one-on-ones" is user data: signing out removes it (see clearSession). */
export const meetingKeys = {
  all: ['one-on-ones'] as const,
  list: (params: ListParams) => ['one-on-ones', 'list', params] as const,
  detail: (id: string) => ['one-on-ones', 'detail', id] as const,
  people: ['one-on-ones', 'people'] as const,
};

export const PAGE_SIZE = 25;

export interface ListParams {
  status: OneOnOneQuery['status'];
  page: number;
}

export const fetchMeetings = ({ status, page }: ListParams) =>
  apiRequest<OneOnOneList>(
    `/one-on-ones?${new URLSearchParams({ status, page: String(page), pageSize: String(PAGE_SIZE) })}`,
  );
export const fetchMeeting = (id: string) => apiRequest<OneOnOneDetail>(`/one-on-ones/${id}`);
export const fetchPeople = () => apiRequest<OneOnOnePeople>('/one-on-ones/people');
export const createMeeting = (body: CreateOneOnOneRequest) =>
  apiRequest<OneOnOneDetail>('/one-on-ones', { method: 'POST', body });
export const updateMeeting = (id: string, body: UpdateOneOnOneRequest) =>
  apiRequest<OneOnOneDetail>(`/one-on-ones/${id}`, { method: 'PATCH', body });
export const addActionItem = (id: string, body: CreateActionItemRequest) =>
  apiRequest<OneOnOneDetail>(`/one-on-ones/${id}/action-items`, { method: 'POST', body });
export const updateActionItem = (id: string, itemId: string, body: UpdateActionItemRequest) =>
  apiRequest<OneOnOneDetail>(`/one-on-ones/${id}/action-items/${itemId}`, {
    method: 'PATCH',
    body,
  });
export const removeActionItem = (id: string, itemId: string) =>
  apiRequest<OneOnOneDetail>(`/one-on-ones/${id}/action-items/${itemId}`, { method: 'DELETE' });
