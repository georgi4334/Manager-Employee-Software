import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createTask, deleteTask, fetchTasks, taskKeys, updateTask, type ListParams } from './api';

export const useTasks = (params: ListParams, enabled = true) =>
  useQuery({
    queryKey: taskKeys.list(params),
    queryFn: () => fetchTasks(params),
    placeholderData: keepPreviousData,
    enabled,
    retry: false,
  });

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: taskKeys.all });
}

export function useCreateTask() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({
      projectId,
      body,
    }: {
      projectId: string;
      body: Parameters<typeof createTask>[1];
    }) => createTask(projectId, body),
    onSuccess: refresh,
  });
}
export function useUpdateTask(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof updateTask>[1]) => updateTask(id, body),
    onSuccess: refresh,
  });
}
export function useDeleteTask() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: deleteTask, onSuccess: refresh });
}
