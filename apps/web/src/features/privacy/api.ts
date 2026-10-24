import type { PersonalDataExport } from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

export const fetchOwnExport = () => apiRequest<PersonalDataExport>('/privacy/export');
export const fetchEmployeeExport = (employeeId: string) =>
  apiRequest<PersonalDataExport>(`/privacy/export/${employeeId}`);
export const eraseEmployee = (employeeId: string) =>
  apiRequest(`/privacy/erase/${employeeId}`, { method: 'POST', body: { confirm: true } });
