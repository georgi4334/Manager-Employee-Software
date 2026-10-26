import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkScheduleRequest, WorkSchedules } from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

export const scheduleKeys = {
  of: (employeeId: string) => ['employees', 'schedule', employeeId] as const,
};

export const useSchedule = (employeeId: string, enabled: boolean) =>
  useQuery({
    queryKey: scheduleKeys.of(employeeId),
    queryFn: () => apiRequest<WorkSchedules>(`/employees/${employeeId}/schedule`),
    enabled,
    retry: false,
  });

/** The answer of a change is the new state, so it goes straight into the cache. */
function useScheduleMutation<V>(employeeId: string, run: (v: V) => Promise<WorkSchedules>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (state) => {
      client.setQueryData(scheduleKeys.of(employeeId), state);
      // Capacity shows the hours too.
      void client.invalidateQueries({ queryKey: ['capacity'] });
    },
  });
}

export const useSetSchedule = (employeeId: string) =>
  useScheduleMutation(employeeId, (body: WorkScheduleRequest) =>
    apiRequest<WorkSchedules>(`/employees/${employeeId}/schedule`, { method: 'PUT', body }),
  );

export const useRemoveSchedule = (employeeId: string) =>
  useScheduleMutation(employeeId, (scheduleId: string) =>
    apiRequest<WorkSchedules>(`/employees/${employeeId}/schedule/${scheduleId}`, {
      method: 'DELETE',
    }),
  );
