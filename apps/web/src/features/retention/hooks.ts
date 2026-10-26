import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RetentionOverview } from '@intime/contracts';
import { fetchRetention, retentionKeys, saveRetention, setHold } from './api';

export const useRetention = () =>
  useQuery({ queryKey: retentionKeys.overview, queryFn: fetchRetention, retry: false });

/** The answer of a change is the new overview, so it goes straight into the cache. */
function useOverviewMutation<V>(run: (v: V) => Promise<RetentionOverview>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (overview) => client.setQueryData(retentionKeys.overview, overview),
  });
}

export const useSaveRetention = () => useOverviewMutation(saveRetention);
export const useSetHold = () =>
  useOverviewMutation(({ employeeId, held }: { employeeId: string; held: boolean }) =>
    setHold(employeeId, held),
  );
