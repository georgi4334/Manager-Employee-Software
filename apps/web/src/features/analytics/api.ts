import type { Analytics } from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "analytics" is user data: signing out removes it (see clearSession). */
export const analyticsKeys = {
  all: ['analytics'] as const,
  overview: (from: string, to: string) => ['analytics', 'overview', from, to] as const,
};

export const fetchAnalytics = (from: string, to: string) =>
  apiRequest<Analytics>(`/analytics?${new URLSearchParams({ from, to })}`);
