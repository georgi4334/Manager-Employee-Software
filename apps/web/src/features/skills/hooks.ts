import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCategory,
  createSkill,
  deleteCategory,
  deleteSkill,
  fetchCatalog,
  fetchPeople,
  fetchPerson,
  removeRating,
  setRating,
  skillKeys,
  updateCategory,
  updateSkill,
  type PeopleParams,
} from './api';

export const useCatalog = () =>
  useQuery({ queryKey: skillKeys.catalog, queryFn: fetchCatalog, retry: false });
export const usePeople = (params: PeopleParams, enabled = true) =>
  useQuery({
    queryKey: skillKeys.people(params),
    queryFn: () => fetchPeople(params),
    placeholderData: keepPreviousData,
    enabled,
    retry: false,
  });
export const usePerson = (employeeId: string, enabled = true) =>
  useQuery({
    queryKey: skillKeys.person(employeeId),
    queryFn: () => fetchPerson(employeeId),
    enabled: enabled && employeeId !== '',
    retry: false,
  });

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: skillKeys.all });
}

export function useSetRating(employeeId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ skillId, level }: { skillId: string; level: number }) =>
      setRating(employeeId, skillId, level),
    onSuccess: refresh,
  });
}
export function useRemoveRating(employeeId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (skillId: string) => removeRating(employeeId, skillId),
    onSuccess: refresh,
  });
}
export function useCreateCategory() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: createCategory, onSuccess: refresh });
}
export function useUpdateCategory() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateCategory(id, { name }),
    onSuccess: refresh,
  });
}
export function useDeleteCategory() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: deleteCategory, onSuccess: refresh });
}
export function useCreateSkill() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: createSkill, onSuccess: refresh });
}
export function useUpdateSkill() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateSkill>[1] }) =>
      updateSkill(id, body),
    onSuccess: refresh,
  });
}
export function useDeleteSkill() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: deleteSkill, onSuccess: refresh });
}
