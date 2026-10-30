import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoleRequest } from '@intime/contracts';
import {
  createRole,
  deleteRole,
  fetchRole,
  fetchRoles,
  moveRole,
  roleKeys,
  updateRole,
} from './api';

export const useRoles = () =>
  useQuery({ queryKey: roleKeys.list, queryFn: fetchRoles, retry: false });
export const useRole = (id: string | undefined) =>
  useQuery({
    queryKey: roleKeys.one(id ?? ''),
    queryFn: () => fetchRole(id!),
    enabled: Boolean(id),
    retry: false,
  });

/** A role change also changes what people holding it may do, and the user list shows role names. */
function useRefresh() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: roleKeys.all }),
      client.invalidateQueries({ queryKey: ['users'] }),
    ]);
}

export function useCreateRole() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: RoleRequest) => createRole(body), onSuccess: refresh });
}
export function useUpdateRole(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: RoleRequest) => updateRole(id, body),
    onSuccess: refresh,
  });
}
export function useDeleteRole(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: () => deleteRole(id), onSuccess: refresh });
}
/** Display only (ADR 0036): moving a role changes no permission, so only the role screens refresh. */
export function useMoveRole() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) =>
      moveRole(id, { parentId }),
    onSuccess: () => client.invalidateQueries({ queryKey: roleKeys.all }),
  });
}
