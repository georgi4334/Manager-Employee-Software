import type {
  CalibrationRequest,
  CreateCompetencyRequest,
  CreateReviewCycleRequest,
  ManagerReviewRequest,
  ReopenRequest,
  ReviewBox,
  ReviewCycle,
  ReviewCycleList,
  ReviewDetail,
  ReviewList,
  SelfReviewRequest,
  UpdateReviewCycleRequest,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "reviews" is user data: signing out removes it (see clearSession). */
export const reviewKeys = {
  all: ['reviews'] as const,
  cycles: ['reviews', 'cycles'] as const,
  list: (params: ListParams) => ['reviews', 'list', params] as const,
  detail: (id: string) => ['reviews', 'detail', id] as const,
};

export const PAGE_SIZE = 25;

export interface ListParams {
  box: ReviewBox;
  cycleId: string;
  page: number;
}

export const fetchCycles = () => apiRequest<ReviewCycleList>('/reviews/cycles');
export const fetchReviews = ({ box, cycleId, page }: ListParams) => {
  const query = new URLSearchParams({ box, page: String(page), pageSize: String(PAGE_SIZE) });
  if (cycleId) query.set('cycleId', cycleId);
  return apiRequest<ReviewList>(`/reviews?${query}`);
};
export const fetchReview = (id: string) => apiRequest<ReviewDetail>(`/reviews/${id}`);

export const createCycle = (body: CreateReviewCycleRequest) =>
  apiRequest<ReviewCycle>('/reviews/cycles', { method: 'POST', body });
export const updateCycle = (id: string, body: UpdateReviewCycleRequest) =>
  apiRequest<ReviewCycle>(`/reviews/cycles/${id}`, { method: 'PATCH', body });
export const deleteCycle = (id: string) =>
  apiRequest(`/reviews/cycles/${id}`, { method: 'DELETE' });
export const addCompetency = (cycleId: string, body: CreateCompetencyRequest) =>
  apiRequest<ReviewCycle>(`/reviews/cycles/${cycleId}/competencies`, { method: 'POST', body });
export const removeCompetency = (cycleId: string, id: string) =>
  apiRequest<ReviewCycle>(`/reviews/cycles/${cycleId}/competencies/${id}`, { method: 'DELETE' });
export const moveCycle = (id: string, step: 'open' | 'calibrate' | 'close') =>
  apiRequest<ReviewCycle>(`/reviews/cycles/${id}/${step}`, { method: 'POST' });

export const saveSelf = (id: string, body: SelfReviewRequest) =>
  apiRequest<ReviewDetail>(`/reviews/${id}/self`, { method: 'PUT', body });
export const submitSelf = (id: string) =>
  apiRequest<ReviewDetail>(`/reviews/${id}/self/submit`, { method: 'POST' });
export const saveManager = (id: string, body: ManagerReviewRequest) =>
  apiRequest<ReviewDetail>(`/reviews/${id}/manager`, { method: 'PUT', body });
export const submitManager = (id: string) =>
  apiRequest<ReviewDetail>(`/reviews/${id}/manager/submit`, { method: 'POST' });
export const calibrate = (id: string, body: CalibrationRequest) =>
  apiRequest<ReviewDetail>(`/reviews/${id}/calibration`, { method: 'PUT', body });
export const reopen = (id: string, body: ReopenRequest) =>
  apiRequest<ReviewDetail>(`/reviews/${id}/reopen`, { method: 'POST', body });
