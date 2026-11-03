import {
  CHECKLIST_KINDS,
  CHECKLIST_LIMITS,
  CHECKLIST_RESPONSIBLES,
  type ChecklistTemplate,
  type CreateChecklistItemRequest,
  type StartChecklistRequest,
  type TemplateRequest,
  type UpdateChecklistItemRequest,
} from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
const title = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(CHECKLIST_LIMITS.title, { error: 'tooLong' });
const description = z.string().trim().max(CHECKLIST_LIMITS.description, { error: 'tooLong' });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'invalidDate' });
const offset = z
  .string()
  .trim()
  .regex(/^-?\d+$/, { error: 'invalidDays' })
  .refine(
    (v) => Number(v) >= CHECKLIST_LIMITS.minOffset && Number(v) <= CHECKLIST_LIMITS.maxOffset,
    { error: 'invalidDays' },
  );

export const templateFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'required' })
    .max(CHECKLIST_LIMITS.name, { error: 'tooLong' }),
  kind: z.enum(CHECKLIST_KINDS),
  isDefault: z.boolean(),
  items: z
    .array(
      z.object({
        title,
        description,
        responsible: z.enum(CHECKLIST_RESPONSIBLES),
        offsetDays: offset,
      }),
    )
    .max(CHECKLIST_LIMITS.items, { error: 'tooMany' }),
});
export type TemplateFormValues = z.input<typeof templateFormSchema>;
export type TemplateStepValues = TemplateFormValues['items'][number];

export const emptyStep = (): TemplateStepValues => ({
  title: '',
  description: '',
  responsible: 'hr',
  offsetDays: '0',
});
export const templateValues = (t?: ChecklistTemplate): TemplateFormValues =>
  t
    ? {
        name: t.name,
        kind: t.kind,
        isDefault: t.isDefault,
        items: t.items.map((i) => ({
          title: i.title,
          description: i.description ?? '',
          responsible: i.responsible,
          offsetDays: String(i.offsetDays),
        })),
      }
    : { name: '', kind: 'onboarding', isDefault: false, items: [emptyStep()] };
export const toTemplateRequest = (v: TemplateFormValues): TemplateRequest => ({
  name: v.name.trim(),
  kind: v.kind,
  isDefault: v.isDefault,
  items: v.items.map((i) => ({
    title: i.title.trim(),
    description: i.description.trim() || null,
    responsible: i.responsible,
    offsetDays: Number(i.offsetDays),
  })),
});

export const itemFormSchema = z.object({
  title,
  description,
  responsible: z.enum(CHECKLIST_RESPONSIBLES),
  dueDate: date,
  /** '' = from "who does it" (new item) or the HR group (existing item). */
  assigneeEmployeeId: z.string(),
});
export type ItemFormValues = z.input<typeof itemFormSchema>;
export const toCreateItem = (v: ItemFormValues): CreateChecklistItemRequest => ({
  title: v.title.trim(),
  description: v.description.trim() || null,
  responsible: v.responsible,
  dueDate: v.dueDate,
  ...(v.assigneeEmployeeId ? { assigneeEmployeeId: v.assigneeEmployeeId } : {}),
});
export const toUpdateItem = (v: ItemFormValues): UpdateChecklistItemRequest => ({
  title: v.title.trim(),
  description: v.description.trim() || null,
  responsible: v.responsible,
  dueDate: v.dueDate,
  assigneeEmployeeId: v.assigneeEmployeeId || null,
});

export const startFormSchema = z.object({
  employeeId: z.string().min(1, { error: 'required' }),
  templateId: z.string().min(1, { error: 'required' }),
  anchorDate: z.union([z.literal(''), date]),
});
export type StartFormValues = z.input<typeof startFormSchema>;
export const toStartRequest = (v: StartFormValues): StartChecklistRequest => ({
  employeeId: v.employeeId,
  templateId: v.templateId,
  ...(v.anchorDate ? { anchorDate: v.anchorDate } : {}),
});
