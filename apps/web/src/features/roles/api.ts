import type { RoleDetail, RoleListItem, RoleParentRequest, RoleRequest } from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "roles" is workspace data: signing out removes it (see clearSession). */
export const roleKeys = {
  all: ['roles'] as const,
  list: ['roles', 'list'] as const,
  one: (id: string) => ['roles', 'one', id] as const,
};

export const fetchRoles = () => apiRequest<RoleListItem[]>('/roles');
export const fetchRole = (id: string) => apiRequest<RoleDetail>(`/roles/${id}`);
export const createRole = (body: RoleRequest) =>
  apiRequest<RoleDetail>('/roles', { method: 'POST', body });
export const updateRole = (id: string, body: RoleRequest) =>
  apiRequest<RoleDetail>(`/roles/${id}`, { method: 'PUT', body });
export const deleteRole = (id: string) => apiRequest(`/roles/${id}`, { method: 'DELETE' });
export const moveRole = (id: string, body: RoleParentRequest) =>
  apiRequest<RoleDetail>(`/roles/${id}/parent`, { method: 'PUT', body });
