import type { DashboardLayout, DashboardWidget } from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

export const dashboardKeys = { layout: ['dashboard', 'layout'] as const };

export const fetchLayout = () => apiRequest<DashboardLayout>('/dashboard/layout');
export const saveLayout = (widgets: DashboardWidget[]) =>
  apiRequest<DashboardLayout>('/dashboard/layout', { method: 'PUT', body: { widgets } });
export const resetLayout = () =>
  apiRequest<DashboardLayout>('/dashboard/layout', { method: 'DELETE' });
