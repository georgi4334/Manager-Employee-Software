import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addKeyResult,
  checkInGoal,
  createGoal,
  deleteGoal,
  fetchGoal,
  fetchGoals,
  fetchGoalTeams,
  goalKeys,
  removeKeyResult,
  updateGoal,
  updateKeyResult,
  type ListParams,
} from './api';

export const useGoals = (params: ListParams, enabled = true) =>
  useQuery({
    queryKey: goalKeys.list(params),
    queryFn: () => fetchGoals(params),
    placeholderData: keepPreviousData,
    enabled,
    retry: false,
  });

export const useGoal = (id: string) =>
  useQuery({ queryKey: goalKeys.detail(id), queryFn: () => fetchGoal(id), retry: false });

export const useGoalTeams = () =>
  useQuery({ queryKey: goalKeys.teams, queryFn: fetchGoalTeams, retry: false });

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: goalKeys.all });
}

export function useCreateGoal() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: createGoal, onSuccess: refresh });
}
export function useUpdateGoal(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof updateGoal>[1]) => updateGoal(id, body),
    onSuccess: refresh,
  });
}
export function useDeleteGoal() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: deleteGoal, onSuccess: refresh });
}
export function useAddKeyResult(goalId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof addKeyResult>[1]) => addKeyResult(goalId, body),
    onSuccess: refresh,
  });
}
export function useUpdateKeyResult(goalId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateKeyResult>[2] }) =>
      updateKeyResult(goalId, id, body),
    onSuccess: refresh,
  });
}
export function useRemoveKeyResult(goalId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => removeKeyResult(goalId, id),
    onSuccess: refresh,
  });
}
export function useCheckIn(goalId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof checkInGoal>[1]) => checkInGoal(goalId, body),
    onSuccess: refresh,
  });
}
