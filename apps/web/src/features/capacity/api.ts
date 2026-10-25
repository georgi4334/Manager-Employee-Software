import type { Capacity } from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "capacity" is user data: signing out removes it (see clearSession). */
export const capacityKeys = {
  all: ['capacity'] as const,
  list: (p: CapacityParams) => ['capacity', 'list', p] as const,
};

export const PAGE_SIZE = 25;

export interface CapacityParams {
  from: string;
  to: string;
  projectId: string;
  q: string;
  page: number;
}

export const fetchCapacity = (p: CapacityParams) => {
  const query = new URLSearchParams({
    from: p.from,
    to: p.to,
    page: String(p.page),
    pageSize: String(PAGE_SIZE),
  });
  if (p.projectId) query.set('projectId', p.projectId);
  if (p.q.trim()) query.set('q', p.q.trim());
  return apiRequest<Capacity>(`/capacity?${query}`);
};
