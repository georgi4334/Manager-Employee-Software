import type {
  CreateEmployeeRequest,
  DeactivateEmployeeRequest,
  Employee,
  EmployeeList,
  InviteEmployeeRequest,
  UpdateEmployeeRequest,
  UpdateOwnEmployeeRequest,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "employees" is user data: signing out removes it (see clearSession). */
export const employeeKeys = {
  all: ['employees'] as const,
  list: (params: ListParams) => ['employees', 'list', params] as const,
  detail: (id: string) => ['employees', 'detail', id] as const,
  me: ['employees', 'me'] as const,
};

export interface ListParams {
  q: string;
  status: 'active' | 'inactive' | 'all';
  page: number;
}

export const PAGE_SIZE = 25;

export const fetchEmployees = ({ q, status, page }: ListParams) => {
  const query = new URLSearchParams({ status, page: String(page), pageSize: String(PAGE_SIZE) });
  if (q.trim()) query.set('q', q.trim());
  return apiRequest<EmployeeList>(`/employees?${query}`);
};

export const fetchEmployee = (id: string) => apiRequest<Employee>(`/employees/${id}`);
export const fetchOwnEmployee = () => apiRequest<Employee>('/employees/me');

export const createEmployee = (body: CreateEmployeeRequest) =>
  apiRequest<Employee>('/employees', { method: 'POST', body });

export const updateEmployee = (id: string, body: UpdateEmployeeRequest) =>
  apiRequest<Employee>(`/employees/${id}`, { method: 'PATCH', body });

export const updateOwnEmployee = (body: UpdateOwnEmployeeRequest) =>
  apiRequest<Employee>('/employees/me', { method: 'PATCH', body });

export const inviteEmployee = (id: string, body: InviteEmployeeRequest) =>
  apiRequest<Employee>(`/employees/${id}/invitation`, { method: 'POST', body });

export const deactivateEmployee = (id: string, body: DeactivateEmployeeRequest) =>
  apiRequest<Employee>(`/employees/${id}/deactivate`, { method: 'POST', body });

export const reactivateEmployee = (id: string) =>
  apiRequest<Employee>(`/employees/${id}/reactivate`, { method: 'POST' });
