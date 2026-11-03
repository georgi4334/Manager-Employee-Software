import type { AuditPage } from '@intime/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';

export interface AuditFilters {
  area?: string;
  from?: string;
  to?: string;
  entityId?: string;
  actorUserId?: string;
  page: number;
}

/** Everything under "audit" is user data: signing out removes it (see clearSession). */
export const auditKeys = {
  all: ['audit'] as const,
  list: (filters: AuditFilters) => ['audit', 'list', filters] as const,
};

export function fetchAuditLog(filters: AuditFilters): Promise<AuditPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return apiRequest<AuditPage>(`/audit-log?${params}`);
}

export const useAuditLog = (filters: AuditFilters, enabled: boolean) =>
  useQuery({
    queryKey: auditKeys.list(filters),
    queryFn: () => fetchAuditLog(filters),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
  });
