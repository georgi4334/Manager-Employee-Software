import type { Employee } from '@intime/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createEmployee,
  deactivateEmployee,
  employeeKeys,
  fetchEmployee,
  fetchEmployees,
  fetchOwnEmployee,
  inviteEmployee,
  reactivateEmployee,
  updateEmployee,
  updateOwnEmployee,
  type ListParams,
} from './api';

export const useEmployees = (params: ListParams) =>
  useQuery({
    queryKey: employeeKeys.list(params),
    queryFn: () => fetchEmployees(params),
    placeholderData: keepPreviousData,
    retry: false,
  });

export const useEmployee = (id: string) =>
  useQuery({ queryKey: employeeKeys.detail(id), queryFn: () => fetchEmployee(id), retry: false });

export const useOwnEmployee = () =>
  useQuery({ queryKey: employeeKeys.me, queryFn: fetchOwnEmployee, retry: false });

/** After any change, the lists and the person's own record are stale; the changed record is already fresh. */
function useAfterChange() {
  const client = useQueryClient();
  return (employee: Employee) => {
    client.setQueryData(employeeKeys.detail(employee.id), employee);
    if (employee.isSelf) client.setQueryData(employeeKeys.me, employee);
    void client.invalidateQueries({ queryKey: ['employees', 'list'] });
  };
}

export function useCreateEmployee() {
  const after = useAfterChange();
  return useMutation({ mutationFn: createEmployee, onSuccess: after });
}

export function useUpdateEmployee(id: string) {
  const after = useAfterChange();
  return useMutation({
    mutationFn: (body: Parameters<typeof updateEmployee>[1]) => updateEmployee(id, body),
    onSuccess: after,
  });
}

export function useUpdateOwnEmployee() {
  const after = useAfterChange();
  return useMutation({ mutationFn: updateOwnEmployee, onSuccess: after });
}

export function useInviteEmployee(id: string) {
  const after = useAfterChange();
  return useMutation({
    mutationFn: (body: Parameters<typeof inviteEmployee>[1]) => inviteEmployee(id, body),
    onSuccess: after,
  });
}

export function useDeactivateEmployee(id: string) {
  const after = useAfterChange();
  return useMutation({
    mutationFn: (body: Parameters<typeof deactivateEmployee>[1]) => deactivateEmployee(id, body),
    onSuccess: after,
  });
}

export function useReactivateEmployee(id: string) {
  const after = useAfterChange();
  return useMutation({ mutationFn: () => reactivateEmployee(id), onSuccess: after });
}
