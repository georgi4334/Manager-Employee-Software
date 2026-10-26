import type { RetentionOverview, UpdateRetentionRequest } from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "retention" is user data: signing out removes it (see clearSession). */
export const retentionKeys = {
  all: ['retention'] as const,
  overview: ['retention', 'overview'] as const,
};

export const fetchRetention = () => apiRequest<RetentionOverview>('/privacy/retention');
export const saveRetention = (body: UpdateRetentionRequest) =>
  apiRequest<RetentionOverview>('/privacy/retention', { method: 'PUT', body });
export const setHold = (employeeId: string, held: boolean) =>
  apiRequest<RetentionOverview>(`/privacy/retention/holds/${employeeId}`, {
    method: 'PUT',
    body: { held },
  });
