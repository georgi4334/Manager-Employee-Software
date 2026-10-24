import type {
  Assignment,
  Client,
  ClientList,
  CreateAssignmentRequest,
  CreateClientRequest,
  CreateMilestoneRequest,
  CreateProjectRequest,
  Milestone,
  ProjectDetail,
  ProjectList,
  ProjectQuery,
  UpdateAssignmentRequest,
  UpdateClientRequest,
  UpdateMilestoneRequest,
  UpdateProjectRequest,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "projects" is user data: signing out removes it (see clearSession). */
export const projectKeys = {
  all: ['projects'] as const,
  list: (params: ListParams) => ['projects', 'list', params] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
  clients: ['projects', 'clients'] as const,
};

export const PAGE_SIZE = 25;

export interface ListParams {
  q: string;
  status: ProjectQuery['status'];
  clientId: string;
  page: number;
}

export const fetchProjects = (params: ListParams) => {
  const query = new URLSearchParams({
    status: params.status,
    page: String(params.page),
    pageSize: String(PAGE_SIZE),
  });
  if (params.q.trim()) query.set('q', params.q.trim());
  if (params.clientId) query.set('clientId', params.clientId);
  return apiRequest<ProjectList>(`/projects?${query}`);
};
export const fetchProject = (id: string) => apiRequest<ProjectDetail>(`/projects/${id}`);
export const createProject = (body: CreateProjectRequest) =>
  apiRequest<ProjectDetail>('/projects', { method: 'POST', body });
export const updateProject = (id: string, body: UpdateProjectRequest) =>
  apiRequest<ProjectDetail>(`/projects/${id}`, { method: 'PATCH', body });

export const fetchClients = () => apiRequest<ClientList>('/clients');
export const createClient = (body: CreateClientRequest) =>
  apiRequest<Client>('/clients', { method: 'POST', body });
export const updateClient = (id: string, body: UpdateClientRequest) =>
  apiRequest<Client>(`/clients/${id}`, { method: 'PATCH', body });

export const createMilestone = (projectId: string, body: CreateMilestoneRequest) =>
  apiRequest<Milestone>(`/projects/${projectId}/milestones`, { method: 'POST', body });
export const updateMilestone = (projectId: string, id: string, body: UpdateMilestoneRequest) =>
  apiRequest<Milestone>(`/projects/${projectId}/milestones/${id}`, { method: 'PATCH', body });
export const deleteMilestone = (projectId: string, id: string) =>
  apiRequest(`/projects/${projectId}/milestones/${id}`, { method: 'DELETE' });

export const createAssignment = (projectId: string, body: CreateAssignmentRequest) =>
  apiRequest<Assignment>(`/projects/${projectId}/assignments`, { method: 'POST', body });
export const updateAssignment = (projectId: string, id: string, body: UpdateAssignmentRequest) =>
  apiRequest<Assignment>(`/projects/${projectId}/assignments/${id}`, { method: 'PATCH', body });
export const deleteAssignment = (projectId: string, id: string) =>
  apiRequest(`/projects/${projectId}/assignments/${id}`, { method: 'DELETE' });
