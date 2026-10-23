import type {
  AssignmentRequest,
  CreateDepartmentRequest,
  CreateTeamRequest,
} from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
const name = z.string().trim().min(1, { error: 'required' }).max(100, { error: 'tooLong' });
/** A select value: "" means "nobody". */
const optionalId = z.string();

export const departmentFormSchema = z.object({
  name,
  parentId: optionalId,
  headEmployeeId: optionalId,
});
export type DepartmentFormValues = z.input<typeof departmentFormSchema>;

export const teamFormSchema = z.object({
  name,
  departmentId: z.string().min(1, { error: 'required' }),
  leadEmployeeId: optionalId,
});
export type TeamFormValues = z.input<typeof teamFormSchema>;

export const assignmentFormSchema = z.object({ managerId: optionalId, departmentId: optionalId });
export type AssignmentFormValues = z.input<typeof assignmentFormSchema>;

const orNull = (value: string) => (value === '' ? null : value);

export const toDepartmentRequest = (values: DepartmentFormValues): CreateDepartmentRequest => ({
  name: values.name.trim(),
  parentId: orNull(values.parentId),
  headEmployeeId: orNull(values.headEmployeeId),
});

export const toTeamRequest = (values: TeamFormValues): CreateTeamRequest => ({
  name: values.name.trim(),
  departmentId: values.departmentId,
  leadEmployeeId: orNull(values.leadEmployeeId),
});

export const toAssignmentRequest = (values: AssignmentFormValues): AssignmentRequest => ({
  managerId: orNull(values.managerId),
  departmentId: orNull(values.departmentId),
});
