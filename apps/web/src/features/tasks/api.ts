import type {
  CreateTaskRequest,
  Task,
  TaskList,
  TaskQuery,
  UpdateTaskRequest,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "tasks" is user data: signing out removes it (see clearSession). */
export const taskKeys = {
  all: ['tasks'] as const,
  list: (params: ListParams) => ['tasks', 'list', params] as const,
};

export const PAGE_SIZE = 50;

export interface ListParams {
  projectId: string;
  mine: boolean;
  status: TaskQuery['status'];
  type: TaskQuery['type'];
  q: string;
  page: number;
  pageSize?: number;
}

export const fetchTasks = (params: ListParams) => {
  const query = new URLSearchParams({
    status: params.status,
    type: params.type,
    page: String(params.page),
    pageSize: String(params.pageSize ?? PAGE_SIZE),
  });
  if (params.projectId) query.set('projectId', params.projectId);
  if (params.mine) query.set('assignee', 'me');
  if (params.q.trim()) query.set('q', params.q.trim());
  return apiRequest<TaskList>(`/tasks?${query}`);
};
export const createTask = (projectId: string, body: CreateTaskRequest) =>
  apiRequest<Task>(`/projects/${projectId}/tasks`, { method: 'POST', body });
export const updateTask = (id: string, body: UpdateTaskRequest) =>
  apiRequest<Task>(`/tasks/${id}`, { method: 'PATCH', body });
export const deleteTask = (id: string) => apiRequest(`/tasks/${id}`, { method: 'DELETE' });
