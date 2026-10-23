import { z } from 'zod';
import { emailSchema } from './auth.js';

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contractor', 'outsourced'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const SENIORITIES = ['intern', 'junior', 'mid', 'senior', 'lead', 'principal'] as const;
export type Seniority = (typeof SENIORITIES)[number];

export const EMPLOYEE_STATUSES = ['active', 'inactive'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const EMPLOYEE_LIST_STATUS_FILTERS = ['active', 'inactive', 'all'] as const;
export const MAX_EMPLOYEE_PAGE_SIZE = 100;
export const DEFAULT_EMPLOYEE_PAGE_SIZE = 50;

// Error messages are keys of the web app's `errors:validation` translations, not display text.
const name = z.string().trim().min(1, { error: 'required' }).max(100, { error: 'tooLong' });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'tooLong' })
    .transform((value) => (value === '' ? null : value));

/** A calendar date as YYYY-MM-DD that really exists (no 2026-02-30). */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'invalidDate' })
  .refine(
    (value) => {
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    },
    { error: 'invalidDate' },
  );

const today = () => new Date().toISOString().slice(0, 10);

const birthDate = dateOnlySchema
  .refine((value) => value >= '1900-01-01', { error: 'invalidDate' })
  .refine((value) => value <= today(), { error: 'futureDate' });
const hireDate = dateOnlySchema.refine((value) => value >= '1970-01-01', { error: 'invalidDate' });

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()\-.]{4,29}$/, { error: 'invalidPhone' });
const country = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, { error: 'invalidCountry' });

/** Fields HR edits. `null` clears an optional value. */
const editableFields = {
  firstName: name,
  lastName: name,
  employeeNo: optionalText(30).nullable(),
  jobTitle: optionalText(100).nullable(),
  location: optionalText(100).nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  seniority: z.enum(SENIORITIES).nullable(),
  hireDate: hireDate.nullable(),
  birthDate: birthDate.nullable(),
  phone: phone.nullable(),
  country: country.nullable(),
};

export const createEmployeeRequestSchema = z
  .object({
    ...editableFields,
    employeeNo: editableFields.employeeNo.optional(),
    jobTitle: editableFields.jobTitle.optional(),
    location: editableFields.location.optional(),
    seniority: editableFields.seniority.optional(),
    hireDate: editableFields.hireDate.optional(),
    birthDate: editableFields.birthDate.optional(),
    phone: editableFields.phone.optional(),
    country: editableFields.country.optional(),
    /** With an email the person is invited to create an account (Employee role). */
    email: emailSchema.optional(),
  })
  .strict();
export type CreateEmployeeRequest = z.infer<typeof createEmployeeRequestSchema>;

export const updateEmployeeRequestSchema = z
  .object(editableFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'required' });
export type UpdateEmployeeRequest = z.infer<typeof updateEmployeeRequestSchema>;

export const updateOwnEmployeeRequestSchema = z.object({ phone: editableFields.phone }).strict();
export type UpdateOwnEmployeeRequest = z.infer<typeof updateOwnEmployeeRequestSchema>;

export const inviteEmployeeRequestSchema = z.object({ email: emailSchema.optional() }).strict();
export type InviteEmployeeRequest = z.infer<typeof inviteEmployeeRequestSchema>;

export const deactivateEmployeeRequestSchema = z
  .object({ terminationDate: dateOnlySchema.optional() })
  .strict();
export type DeactivateEmployeeRequest = z.infer<typeof deactivateEmployeeRequestSchema>;

export const employeeQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(EMPLOYEE_LIST_STATUS_FILTERS).default('active'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_EMPLOYEE_PAGE_SIZE)
    .default(DEFAULT_EMPLOYEE_PAGE_SIZE),
});
export type EmployeeQuery = z.infer<typeof employeeQuerySchema>;

export const employeeProfileSchema = z.object({
  employeeNo: z.string().nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  seniority: z.enum(SENIORITIES).nullable(),
  hireDate: z.string().nullable(),
  terminationDate: z.string().nullable(),
  birthDate: z.string().nullable(),
  phone: z.string().nullable(),
  country: z.string().nullable(),
  /** invited / active / disabled, or null when the employee has no account. */
  accountStatus: z.enum(['invited', 'active', 'disabled']).nullable(),
});
export type EmployeeProfile = z.infer<typeof employeeProfileSchema>;

export const employeeSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  jobTitle: z.string().nullable(),
  location: z.string().nullable(),
  email: z.string().nullable(),
  status: z.enum(EMPLOYEE_STATUSES),
  /** Whether this employee is the caller. */
  isSelf: z.boolean(),
  /** null when the caller may only see directory data. */
  profile: employeeProfileSchema.nullable(),
});
export type Employee = z.infer<typeof employeeSchema>;

export const employeeListSchema = z.object({
  items: z.array(employeeSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type EmployeeList = z.infer<typeof employeeListSchema>;
