import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Compensation, CompensationRequest } from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Under "employees" so signing out removes it with the rest of the personal data. */
export const compensationKeys = {
  of: (employeeId: string) => ['employees', 'compensation', employeeId] as const,
};

export const useCompensation = (employeeId: string, enabled: boolean) =>
  useQuery({
    queryKey: compensationKeys.of(employeeId),
    queryFn: () => apiRequest<Compensation>(`/employees/${employeeId}/compensation`),
    enabled,
    retry: false,
    // Pay is never kept around: read it again every time the card opens.
    gcTime: 0,
  });

/** The answer of a change is the new state, so it goes straight into the cache. */
function useCompensationMutation<V>(employeeId: string, run: (v: V) => Promise<Compensation>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (state) => client.setQueryData(compensationKeys.of(employeeId), state),
  });
}

export const useSetCompensation = (employeeId: string) =>
  useCompensationMutation(employeeId, (body: CompensationRequest) =>
    apiRequest<Compensation>(`/employees/${employeeId}/compensation`, { method: 'PUT', body }),
  );

export const useRemoveCompensation = (employeeId: string) =>
  useCompensationMutation(employeeId, (rowId: string) =>
    apiRequest<Compensation>(`/employees/${employeeId}/compensation/${rowId}`, {
      method: 'DELETE',
    }),
  );
