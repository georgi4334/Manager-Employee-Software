import type {
  CreateSkillCategoryRequest,
  CreateSkillRequest,
  PersonSkills,
  SkillCatalog,
  SkillPeople,
  UpdateSkillCategoryRequest,
  UpdateSkillRequest,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "skills" is user data: signing out removes it (see clearSession). */
export const skillKeys = {
  all: ['skills'] as const,
  catalog: ['skills', 'catalog'] as const,
  people: (params: PeopleParams) => ['skills', 'people', params] as const,
  person: (id: string) => ['skills', 'person', id] as const,
};

export const PAGE_SIZE = 25;

export interface PeopleParams {
  q: string;
  categoryId: string;
  skillId: string;
  minLevel: string;
  page: number;
}

export const fetchCatalog = () => apiRequest<SkillCatalog>('/skills/catalog');
export const fetchPeople = (p: PeopleParams) => {
  const query = new URLSearchParams({ page: String(p.page), pageSize: String(PAGE_SIZE) });
  if (p.q.trim()) query.set('q', p.q.trim());
  if (p.categoryId) query.set('categoryId', p.categoryId);
  if (p.skillId) {
    query.set('skillId', p.skillId);
    if (p.minLevel) query.set('minLevel', p.minLevel);
  }
  return apiRequest<SkillPeople>(`/skills/people?${query}`);
};
export const fetchPerson = (employeeId: string) =>
  apiRequest<PersonSkills>(`/skills/employees/${employeeId}`);
export const setRating = (employeeId: string, skillId: string, level: number) =>
  apiRequest<PersonSkills>(`/skills/employees/${employeeId}/ratings/${skillId}`, {
    method: 'PUT',
    body: { level },
  });
export const removeRating = (employeeId: string, skillId: string) =>
  apiRequest<PersonSkills>(`/skills/employees/${employeeId}/ratings/${skillId}`, {
    method: 'DELETE',
  });
export const createCategory = (body: CreateSkillCategoryRequest) =>
  apiRequest<SkillCatalog>('/skills/categories', { method: 'POST', body });
export const updateCategory = (id: string, body: UpdateSkillCategoryRequest) =>
  apiRequest<SkillCatalog>(`/skills/categories/${id}`, { method: 'PATCH', body });
export const deleteCategory = (id: string) =>
  apiRequest(`/skills/categories/${id}`, { method: 'DELETE' });
export const createSkill = (body: CreateSkillRequest) =>
  apiRequest<SkillCatalog>('/skills', { method: 'POST', body });
export const updateSkill = (id: string, body: UpdateSkillRequest) =>
  apiRequest<SkillCatalog>(`/skills/${id}`, { method: 'PATCH', body });
export const deleteSkill = (id: string) => apiRequest(`/skills/${id}`, { method: 'DELETE' });
