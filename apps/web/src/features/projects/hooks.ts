import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAssignment,
  createClient,
  createMilestone,
  createProject,
  deleteAssignment,
  deleteMilestone,
  fetchClients,
  fetchProject,
  fetchProjects,
  projectKeys,
  updateAssignment,
  updateClient,
  updateMilestone,
  updateProject,
  type ListParams,
} from './api';

export const useProjects = (params: ListParams) =>
  useQuery({
    queryKey: projectKeys.list(params),
    queryFn: () => fetchProjects(params),
    placeholderData: keepPreviousData,
    retry: false,
  });

export const useProject = (id: string) =>
  useQuery({ queryKey: projectKeys.detail(id), queryFn: () => fetchProject(id), retry: false });

export const useClients = (enabled = true) =>
  useQuery({ queryKey: projectKeys.clients, queryFn: fetchClients, enabled, retry: false });

/** Staffing, milestones and clients change lists, details and health everywhere: refresh all of "projects". */
function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: projectKeys.all });
}

export function useCreateProject() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: createProject, onSuccess: refresh });
}
export function useUpdateProject(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof updateProject>[1]) => updateProject(id, body),
    onSuccess: refresh,
  });
}
export function useCreateClient() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: createClient, onSuccess: refresh });
}
export function useUpdateClient(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof updateClient>[1]) => updateClient(id, body),
    onSuccess: refresh,
  });
}
export function useCreateMilestone(projectId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof createMilestone>[1]) => createMilestone(projectId, body),
    onSuccess: refresh,
  });
}
export function useUpdateMilestone(projectId: string, id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof updateMilestone>[2]) =>
      updateMilestone(projectId, id, body),
    onSuccess: refresh,
  });
}
export function useDeleteMilestone(projectId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => deleteMilestone(projectId, id),
    onSuccess: refresh,
  });
}
export function useCreateAssignment(projectId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof createAssignment>[1]) => createAssignment(projectId, body),
    onSuccess: refresh,
  });
}
export function useUpdateAssignment(projectId: string, id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof updateAssignment>[2]) =>
      updateAssignment(projectId, id, body),
    onSuccess: refresh,
  });
}
export function useDeleteAssignment(projectId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => deleteAssignment(projectId, id),
    onSuccess: refresh,
  });
}
