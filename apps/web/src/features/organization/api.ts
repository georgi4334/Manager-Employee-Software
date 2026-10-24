import type {
  AssignmentRequest,
  CreateDepartmentRequest,
  CreateTeamRequest,
  Department,
  OrgChart,
  SetTeamMembersRequest,
  Team,
  UpdateDepartmentRequest,
  UpdateTeamRequest,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "org" is user data: signing out removes it (see clearSession). */
export const orgKeys = {
  all: ['org'] as const,
  chart: ['org', 'chart'] as const,
  departments: ['org', 'departments'] as const,
  teams: ['org', 'teams'] as const,
};

export const fetchChart = () => apiRequest<OrgChart>('/org/chart');
export const fetchDepartments = () => apiRequest<Department[]>('/org/departments');
export const fetchTeams = () => apiRequest<Team[]>('/org/teams');

export const createDepartment = (body: CreateDepartmentRequest) =>
  apiRequest<Department>('/org/departments', { method: 'POST', body });
export const updateDepartment = (id: string, body: UpdateDepartmentRequest) =>
  apiRequest<Department>(`/org/departments/${id}`, { method: 'PATCH', body });
export const deleteDepartment = (id: string) =>
  apiRequest(`/org/departments/${id}`, { method: 'DELETE' });

export const createTeam = (body: CreateTeamRequest) =>
  apiRequest<Team>('/org/teams', { method: 'POST', body });
export const updateTeam = (id: string, body: UpdateTeamRequest) =>
  apiRequest<Team>(`/org/teams/${id}`, { method: 'PATCH', body });
export const deleteTeam = (id: string) => apiRequest(`/org/teams/${id}`, { method: 'DELETE' });
export const setTeamMembers = (id: string, body: SetTeamMembersRequest) =>
  apiRequest<Team>(`/org/teams/${id}/members`, { method: 'PUT', body });

export const assignEmployee = (id: string, body: AssignmentRequest) =>
  apiRequest(`/org/employees/${id}/assignment`, { method: 'PUT', body });
