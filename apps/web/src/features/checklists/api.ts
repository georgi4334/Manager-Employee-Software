import type {
  ChecklistDetail,
  ChecklistList,
  ChecklistQuery,
  ChecklistTemplate,
  ChecklistTemplateList,
  CreateChecklistItemRequest,
  MyChecklistItemList,
  StartChecklistRequest,
  TemplateRequest,
  UpdateChecklistItemRequest,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "checklists" is user data: signing out removes it (see clearSession). */
export const checklistKeys = {
  all: ['checklists'] as const,
  list: (params: ListParams) => ['checklists', 'list', params] as const,
  detail: (id: string) => ['checklists', 'detail', id] as const,
  mine: ['checklists', 'mine'] as const,
  templates: ['checklists', 'templates'] as const,
  template: (id: string) => ['checklists', 'template', id] as const,
};

export const PAGE_SIZE = 25;

export interface ListParams {
  kind: ChecklistQuery['kind'];
  status: ChecklistQuery['status'];
  page: number;
}

export const fetchChecklists = (params: ListParams) =>
  apiRequest<ChecklistList>(
    `/checklists?${new URLSearchParams({
      kind: params.kind,
      status: params.status,
      page: String(params.page),
      pageSize: String(PAGE_SIZE),
    })}`,
  );
export const fetchChecklist = (id: string) => apiRequest<ChecklistDetail>(`/checklists/${id}`);
export const fetchMyItems = () => apiRequest<MyChecklistItemList>('/checklists/my-items');
export const startChecklist = (body: StartChecklistRequest) =>
  apiRequest<ChecklistDetail>('/checklists', { method: 'POST', body });
export const cancelChecklist = (id: string) =>
  apiRequest<ChecklistDetail>(`/checklists/${id}/cancel`, { method: 'POST' });
export const addItem = (id: string, body: CreateChecklistItemRequest) =>
  apiRequest<ChecklistDetail>(`/checklists/${id}/items`, { method: 'POST', body });
export const updateItem = (id: string, itemId: string, body: UpdateChecklistItemRequest) =>
  apiRequest<ChecklistDetail>(`/checklists/${id}/items/${itemId}`, { method: 'PATCH', body });
export const deleteItem = (id: string, itemId: string) =>
  apiRequest<ChecklistDetail>(`/checklists/${id}/items/${itemId}`, { method: 'DELETE' });
export const tickItem = (id: string, itemId: string, done: boolean) =>
  apiRequest<ChecklistDetail>(`/checklists/${id}/items/${itemId}/done`, {
    method: 'PUT',
    body: { done },
  });

export const fetchTemplates = () => apiRequest<ChecklistTemplateList>('/checklist-templates');
export const fetchTemplate = (id: string) =>
  apiRequest<ChecklistTemplate>(`/checklist-templates/${id}`);
export const createTemplate = (body: TemplateRequest) =>
  apiRequest<ChecklistTemplate>('/checklist-templates', { method: 'POST', body });
export const updateTemplate = (id: string, body: TemplateRequest) =>
  apiRequest<ChecklistTemplate>(`/checklist-templates/${id}`, { method: 'PUT', body });
export const deleteTemplate = (id: string) =>
  apiRequest(`/checklist-templates/${id}`, { method: 'DELETE' });
