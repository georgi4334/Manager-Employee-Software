import type {
  CreateChecklistItemRequest,
  StartChecklistRequest,
  TemplateRequest,
  UpdateChecklistItemRequest,
} from '@intime/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addItem,
  cancelChecklist,
  checklistKeys,
  createTemplate,
  deleteItem,
  deleteTemplate,
  fetchChecklist,
  fetchChecklists,
  fetchMyItems,
  fetchTemplate,
  fetchTemplates,
  startChecklist,
  tickItem,
  updateItem,
  updateTemplate,
  type ListParams,
} from './api';

export const useChecklists = (params: ListParams, enabled = true) =>
  useQuery({
    queryKey: checklistKeys.list(params),
    queryFn: () => fetchChecklists(params),
    placeholderData: keepPreviousData,
    enabled,
    retry: false,
  });
export const useChecklist = (id: string) =>
  useQuery({ queryKey: checklistKeys.detail(id), queryFn: () => fetchChecklist(id), retry: false });
export const useMyItems = (enabled = true) =>
  useQuery({
    queryKey: checklistKeys.mine,
    queryFn: fetchMyItems,
    enabled,
    retry: false,
    staleTime: 60_000,
  });
export const useTemplates = (enabled = true) =>
  useQuery({ queryKey: checklistKeys.templates, queryFn: fetchTemplates, enabled, retry: false });
export const useTemplate = (id: string, enabled = true) =>
  useQuery({
    queryKey: checklistKeys.template(id),
    queryFn: () => fetchTemplate(id),
    enabled: enabled && id !== '',
    retry: false,
  });

/** Any change can move a checklist's progress, the "my items" list and the inbox. */
function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: checklistKeys.all });
}

export function useStartChecklist() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: StartChecklistRequest) => startChecklist(body),
    onSuccess: refresh,
  });
}
export function useCancelChecklist(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: () => cancelChecklist(id), onSuccess: refresh });
}
export function useAddItem(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: CreateChecklistItemRequest) => addItem(id, body),
    onSuccess: refresh,
  });
}
export function useUpdateItem(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: UpdateChecklistItemRequest }) =>
      updateItem(id, itemId, body),
    onSuccess: refresh,
  });
}
export function useDeleteItem(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (itemId: string) => deleteItem(id, itemId),
    onSuccess: refresh,
  });
}
/** Ticks an item of any checklist (the inbox and "My to-dos" tick items of several checklists). */
export function useTickItem() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({
      checklistId,
      itemId,
      done,
    }: {
      checklistId: string;
      itemId: string;
      done: boolean;
    }) => tickItem(checklistId, itemId, done),
    onSuccess: refresh,
  });
}
export function useSaveTemplate(id: string | null) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: TemplateRequest) => (id ? updateTemplate(id, body) : createTemplate(body)),
    onSuccess: refresh,
  });
}
export function useDeleteTemplate() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => deleteTemplate(id), onSuccess: refresh });
}
