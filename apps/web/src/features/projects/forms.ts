import {
  MAX_NOTES,
  MAX_PROJECT_DESCRIPTION,
  MAX_PROJECT_NAME,
  MAX_ROLE,
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  type CreateAssignmentRequest,
  type CreateClientRequest,
  type CreateMilestoneRequest,
  type CreateProjectRequest,
  type ProjectDetail,
  type UpdateAssignmentRequest,
  type UpdateClientRequest,
  type UpdateProjectRequest,
} from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
const date = z
  .string()
  .min(1, { error: 'required', abort: true })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'invalidDate' });
const optionalDate = z
  .string()
  .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), { error: 'invalidDate' });
const name = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(MAX_PROJECT_NAME, { error: 'tooLong' });

// ----- clients ---------------------------------------------------------------------------------

export const clientFormSchema = z.object({
  name,
  contactName: z.string().trim().max(100, { error: 'tooLong' }),
  contactEmail: z
    .string()
    .trim()
    .refine((v) => v === '' || z.email().safeParse(v).success, { error: 'email' }),
  notes: z.string().trim().max(MAX_NOTES, { error: 'tooLong' }),
});
export type ClientFormValues = z.input<typeof clientFormSchema>;

export const toCreateClient = (v: ClientFormValues): CreateClientRequest => ({
  name: v.name.trim(),
  ...(v.contactName.trim() ? { contactName: v.contactName.trim() } : {}),
  ...(v.contactEmail.trim() ? { contactEmail: v.contactEmail.trim().toLowerCase() } : {}),
  ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
});
export const toUpdateClient = (v: ClientFormValues): UpdateClientRequest => ({
  name: v.name.trim(),
  contactName: v.contactName.trim() === '' ? null : v.contactName.trim(),
  contactEmail: v.contactEmail.trim() === '' ? null : v.contactEmail.trim().toLowerCase(),
  notes: v.notes.trim() === '' ? null : v.notes.trim(),
});

// ----- projects --------------------------------------------------------------------------------

export const projectFormSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9-]{1,11}$/, { error: 'invalidCode' }),
    name,
    description: z.string().trim().max(MAX_PROJECT_DESCRIPTION, { error: 'tooLong' }),
    clientId: z.string(),
    status: z.enum(PROJECT_STATUSES),
    priority: z.enum(PROJECT_PRIORITIES),
    isBillable: z.boolean(),
    budgetHours: z
      .string()
      .trim()
      .refine(
        (v) =>
          v === '' ||
          (!Number.isNaN(Number(v)) && Number(v) >= 0 && Number.isInteger(Number(v) * 2)),
        { error: 'invalidHours' },
      ),
    startDate: date,
    endDate: optionalDate,
    leadEmployeeId: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && value.endDate < value.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'end_before_start' });
    }
  });
export type ProjectFormValues = z.input<typeof projectFormSchema>;

export const emptyProject = (today: string): ProjectFormValues => ({
  code: '',
  name: '',
  description: '',
  clientId: '',
  status: 'planned',
  priority: 'normal',
  isBillable: true,
  budgetHours: '',
  startDate: today,
  endDate: '',
  leadEmployeeId: '',
});

export const valuesOfProject = (p: ProjectDetail): ProjectFormValues => ({
  code: p.code,
  name: p.name,
  description: p.description ?? '',
  clientId: p.client?.id ?? '',
  status: p.status,
  priority: p.priority,
  isBillable: p.isBillable,
  budgetHours: p.budgetHours === null ? '' : String(p.budgetHours),
  startDate: p.startDate,
  endDate: p.endDate ?? '',
  leadEmployeeId: p.lead?.id ?? '',
});

export const toCreateProject = (v: ProjectFormValues): CreateProjectRequest => ({
  code: v.code.trim(),
  name: v.name.trim(),
  ...(v.description.trim() ? { description: v.description.trim() } : {}),
  ...(v.clientId ? { clientId: v.clientId } : {}),
  status: v.status,
  priority: v.priority,
  isBillable: v.isBillable,
  ...(v.budgetHours.trim() ? { budgetHours: Number(v.budgetHours) } : {}),
  startDate: v.startDate,
  ...(v.endDate ? { endDate: v.endDate } : {}),
  ...(v.leadEmployeeId ? { leadEmployeeId: v.leadEmployeeId } : {}),
});

/** What changed against the loaded project, so a manager editing the name never sends (or fights over) the lead. */
export const toUpdateProject = (
  v: ProjectFormValues,
  current: ProjectFormValues,
): UpdateProjectRequest => {
  const body: UpdateProjectRequest = {};
  if (v.code.trim().toUpperCase() !== current.code) body.code = v.code.trim();
  if (v.name.trim() !== current.name) body.name = v.name.trim();
  if (v.description.trim() !== current.description) {
    body.description = v.description.trim() === '' ? null : v.description.trim();
  }
  if (v.clientId !== current.clientId) body.clientId = v.clientId === '' ? null : v.clientId;
  if (v.status !== current.status) body.status = v.status;
  if (v.priority !== current.priority) body.priority = v.priority;
  if (v.isBillable !== current.isBillable) body.isBillable = v.isBillable;
  if (v.budgetHours.trim() !== current.budgetHours) {
    body.budgetHours = v.budgetHours.trim() === '' ? null : Number(v.budgetHours);
  }
  if (v.startDate !== current.startDate) body.startDate = v.startDate;
  if (v.endDate !== current.endDate) body.endDate = v.endDate === '' ? null : v.endDate;
  if (v.leadEmployeeId !== current.leadEmployeeId) {
    body.leadEmployeeId = v.leadEmployeeId === '' ? null : v.leadEmployeeId;
  }
  return body;
};

// ----- milestones and assignments --------------------------------------------------------------

export const milestoneFormSchema = z.object({ title: name, dueDate: date });
export type MilestoneFormValues = z.input<typeof milestoneFormSchema>;
export const toMilestone = (v: MilestoneFormValues): CreateMilestoneRequest => ({
  title: v.title.trim(),
  dueDate: v.dueDate,
});

export const assignmentFormSchema = z
  .object({
    employeeId: z.string().min(1, { error: 'required' }),
    role: z.string().trim().max(MAX_ROLE, { error: 'tooLong' }),
    allocationPct: z
      .string()
      .trim()
      .min(1, { error: 'required', abort: true })
      .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 100, {
        error: 'invalidAllocation',
      }),
    fromDate: date,
    toDate: optionalDate,
  })
  .superRefine((value, ctx) => {
    if (value.fromDate && value.toDate && value.toDate < value.fromDate) {
      ctx.addIssue({ code: 'custom', path: ['toDate'], message: 'end_before_start' });
    }
  });
export type AssignmentFormValues = z.input<typeof assignmentFormSchema>;

export const toCreateAssignment = (v: AssignmentFormValues): CreateAssignmentRequest => ({
  employeeId: v.employeeId,
  ...(v.role.trim() ? { role: v.role.trim() } : {}),
  allocationPct: Number(v.allocationPct),
  fromDate: v.fromDate,
  ...(v.toDate ? { toDate: v.toDate } : {}),
});
export const toUpdateAssignment = (v: AssignmentFormValues): UpdateAssignmentRequest => ({
  role: v.role.trim() === '' ? null : v.role.trim(),
  allocationPct: Number(v.allocationPct),
  fromDate: v.fromDate,
  toDate: v.toDate === '' ? null : v.toDate,
});
