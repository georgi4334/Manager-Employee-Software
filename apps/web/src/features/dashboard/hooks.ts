import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DashboardLayout, DashboardWidget } from '@intime/contracts';
import { dashboardKeys, fetchLayout, resetLayout, saveLayout } from './api';

export const useDashboardLayout = () =>
  useQuery({ queryKey: dashboardKeys.layout, queryFn: fetchLayout, retry: false });

/** The answer is the stored layout, so it goes straight into the cache. */
function useLayoutMutation<V>(run: (v: V) => Promise<DashboardLayout>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (layout) => client.setQueryData(dashboardKeys.layout, layout),
  });
}

export const useSaveLayout = () =>
  useLayoutMutation((widgets: DashboardWidget[]) => saveLayout(widgets));
export const useResetLayout = () => useLayoutMutation(() => resetLayout());
