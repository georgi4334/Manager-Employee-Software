import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignEmployee,
  createDepartment,
  createTeam,
  deleteDepartment,
  deleteTeam,
  fetchChart,
  fetchDepartments,
  fetchTeams,
  orgKeys,
  setTeamMembers,
  updateDepartment,
  updateTeam,
} from './api';

export const useChart = () =>
  useQuery({ queryKey: orgKeys.chart, queryFn: fetchChart, retry: false });
export const useDepartments = () =>
  useQuery({ queryKey: orgKeys.departments, queryFn: fetchDepartments, retry: false });
export const useTeams = () =>
  useQuery({ queryKey: orgKeys.teams, queryFn: fetchTeams, retry: false });

/** Structure changes also change what employee records show (department, manager, teams). */
function useRefresh() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: orgKeys.all }),
      client.invalidateQueries({ queryKey: ['employees'] }),
    ]);
}

export function useCreateDepartment() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: createDepartment, onSuccess: refresh });
}
export function useUpdateDepartment(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof updateDepartment>[1]) => updateDepartment(id, body),
    onSuccess: refresh,
  });
}
export function useDeleteDepartment(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: () => deleteDepartment(id), onSuccess: refresh });
}
export function useCreateTeam() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: createTeam, onSuccess: refresh });
}
export function useUpdateTeam(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof updateTeam>[1]) => updateTeam(id, body),
    onSuccess: refresh,
  });
}
export function useDeleteTeam(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: () => deleteTeam(id), onSuccess: refresh });
}
export function useSetTeamMembers(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof setTeamMembers>[1]) => setTeamMembers(id, body),
    onSuccess: refresh,
  });
}
export function useAssignEmployee(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof assignEmployee>[1]) => assignEmployee(id, body),
    onSuccess: refresh,
  });
}
