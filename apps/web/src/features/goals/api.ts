import type {
  CreateGoalRequest,
  CreateKeyResultRequest,
  GoalCheckInRequest,
  GoalDetail,
  GoalList,
  GoalQuery,
  GoalTeams,
  UpdateGoalRequest,
  UpdateKeyResultRequest,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "goals" is user data: signing out removes it (see clearSession). */
export const goalKeys = {
  all: ['goals'] as const,
  list: (params: ListParams) => ['goals', 'list', params] as const,
  detail: (id: string) => ['goals', 'detail', id] as const,
  teams: ['goals', 'teams'] as const,
};

export const PAGE_SIZE = 25;

export interface ListParams {
  scope: GoalQuery['scope'];
  status: GoalQuery['status'];
  q: string;
  page: number;
  pageSize?: number;
}

export const fetchGoals = (params: ListParams) => {
  const query = new URLSearchParams({
    scope: params.scope,
    status: params.status,
    page: String(params.page),
    pageSize: String(params.pageSize ?? PAGE_SIZE),
  });
  if (params.q.trim()) query.set('q', params.q.trim());
  return apiRequest<GoalList>(`/goals?${query}`);
};
export const fetchGoal = (id: string) => apiRequest<GoalDetail>(`/goals/${id}`);
export const fetchGoalTeams = () => apiRequest<GoalTeams>('/goals/teams');
export const createGoal = (body: CreateGoalRequest) =>
  apiRequest<GoalDetail>('/goals', { method: 'POST', body });
export const updateGoal = (id: string, body: UpdateGoalRequest) =>
  apiRequest<GoalDetail>(`/goals/${id}`, { method: 'PATCH', body });
export const deleteGoal = (id: string) => apiRequest(`/goals/${id}`, { method: 'DELETE' });
export const addKeyResult = (goalId: string, body: CreateKeyResultRequest) =>
  apiRequest<GoalDetail>(`/goals/${goalId}/key-results`, { method: 'POST', body });
export const updateKeyResult = (goalId: string, id: string, body: UpdateKeyResultRequest) =>
  apiRequest<GoalDetail>(`/goals/${goalId}/key-results/${id}`, { method: 'PATCH', body });
export const removeKeyResult = (goalId: string, id: string) =>
  apiRequest<GoalDetail>(`/goals/${goalId}/key-results/${id}`, { method: 'DELETE' });
export const checkInGoal = (goalId: string, body: GoalCheckInRequest) =>
  apiRequest<GoalDetail>(`/goals/${goalId}/updates`, { method: 'POST', body });
