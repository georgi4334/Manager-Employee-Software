import type {
  CreateFeedbackRequest,
  FeedbackItem,
  FeedbackList,
  FeedbackQuery,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "feedback" is user data: signing out removes it (see clearSession). */
export const feedbackKeys = {
  all: ['feedback'] as const,
  list: (params: ListParams) => ['feedback', 'list', params] as const,
};

export const PAGE_SIZE = 25;

export interface ListParams {
  box: FeedbackQuery['box'];
  /** Received feedback of this person (shared with their manager); empty = yourself. */
  employeeId: string;
  page: number;
}

export const fetchFeedback = ({ box, employeeId, page }: ListParams) => {
  const query = new URLSearchParams({ box, page: String(page), pageSize: String(PAGE_SIZE) });
  if (box === 'received' && employeeId) query.set('employeeId', employeeId);
  return apiRequest<FeedbackList>(`/feedback?${query}`);
};
export const giveFeedback = (body: CreateFeedbackRequest) =>
  apiRequest<FeedbackItem>('/feedback', { method: 'POST', body });
export const removeFeedback = (id: string) => apiRequest(`/feedback/${id}`, { method: 'DELETE' });
export const reportFeedback = (id: string) =>
  apiRequest<FeedbackItem>(`/feedback/${id}/report`, { method: 'POST' });
export const keepFeedback = (id: string) =>
  apiRequest<FeedbackItem>(`/feedback/${id}/keep`, { method: 'POST' });
