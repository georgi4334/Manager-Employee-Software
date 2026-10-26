import { MAX_SKILL_DESCRIPTION, MAX_SKILL_NAME, type CreateSkillRequest } from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
const name = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(MAX_SKILL_NAME, { error: 'tooLong' });

export const categoryFormSchema = z.object({ name });
export type CategoryFormValues = z.input<typeof categoryFormSchema>;

export const skillFormSchema = z.object({
  categoryId: z.string().min(1, { error: 'required' }),
  name,
  description: z.string().trim().max(MAX_SKILL_DESCRIPTION, { error: 'tooLong' }),
});
export type SkillFormValues = z.input<typeof skillFormSchema>;
export const emptySkill = (categoryId = ''): SkillFormValues => ({
  categoryId,
  name: '',
  description: '',
});
export const toCreateSkill = (v: SkillFormValues): CreateSkillRequest => ({
  categoryId: v.categoryId,
  name: v.name.trim(),
  ...(v.description.trim() ? { description: v.description.trim() } : {}),
});
