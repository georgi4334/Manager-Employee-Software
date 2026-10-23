import {
  EMPLOYMENT_TYPES,
  SENIORITIES,
  normalizeEmail,
  type CreateEmployeeRequest,
  type Employee,
  type UpdateEmployeeRequest,
} from '@intime/contracts';
import { z } from 'zod';

/**
 * Form schemas. Messages are keys of the `errors:validation` translations. The rules mirror the API's
 * schemas (@intime/contracts); forms.test.ts checks that data accepted here is accepted there too.
 */
const text = (max: number) => z.string().trim().max(max, { error: 'tooLong' });
const required = (max: number) => text(max).min(1, { error: 'required' });
const dateText = z
  .string()
  .trim()
  .refine((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), { error: 'invalidDate' });

export const employeeFormSchema = z.object({
  firstName: required(100),
  lastName: required(100),
  email: z
    .string()
    .trim()
    .max(254, { error: 'tooLong' })
    .refine((value) => value === '' || z.email().safeParse(value).success, { error: 'email' }),
  employeeNo: text(30),
  jobTitle: text(100),
  location: text(100),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  seniority: z.union([z.enum(SENIORITIES), z.literal('')]),
  hireDate: dateText,
  birthDate: dateText.refine(
    (value) => value === '' || value <= new Date().toISOString().slice(0, 10),
    {
      error: 'futureDate',
    },
  ),
  phone: text(30).refine((value) => value === '' || /^\+?[0-9][0-9 ()\-.]{4,29}$/.test(value), {
    error: 'invalidPhone',
  }),
  country: text(2).refine((value) => value === '' || /^[A-Za-z]{2}$/.test(value), {
    error: 'invalidCountry',
  }),
});
export type EmployeeFormValues = z.input<typeof employeeFormSchema>;

export const EMPTY_EMPLOYEE_FORM: EmployeeFormValues = {
  firstName: '',
  lastName: '',
  email: '',
  employeeNo: '',
  jobTitle: '',
  location: '',
  employmentType: 'full_time',
  seniority: '',
  hireDate: '',
  birthDate: '',
  phone: '',
  country: '',
};

/** Form values of an existing employee (the profile is null if the caller may not see it; then HR edits are not offered). */
export function formValuesOf(employee: Employee): EmployeeFormValues {
  const profile = employee.profile;
  return {
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email ?? '',
    employeeNo: profile?.employeeNo ?? '',
    jobTitle: employee.jobTitle ?? '',
    location: employee.location ?? '',
    employmentType: profile?.employmentType ?? 'full_time',
    seniority: profile?.seniority ?? '',
    hireDate: profile?.hireDate ?? '',
    birthDate: profile?.birthDate ?? '',
    phone: profile?.phone ?? '',
    country: profile?.country ?? '',
  };
}

const orNull = (value: string) => (value === '' ? null : value);
const orUndefined = (value: string) => (value === '' ? undefined : value);

export function toCreateRequest(values: EmployeeFormValues): CreateEmployeeRequest {
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    employmentType: values.employmentType,
    email: values.email ? normalizeEmail(values.email) : undefined,
    employeeNo: orUndefined(values.employeeNo),
    jobTitle: orUndefined(values.jobTitle),
    location: orUndefined(values.location),
    seniority: values.seniority === '' ? undefined : values.seniority,
    hireDate: orUndefined(values.hireDate),
    birthDate: orUndefined(values.birthDate),
    phone: orUndefined(values.phone),
    country: orUndefined(values.country),
  };
}

/** Every editable field is sent; the API ignores the ones that did not change. Empty means "clear". */
export function toUpdateRequest(values: EmployeeFormValues): UpdateEmployeeRequest {
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    employmentType: values.employmentType,
    employeeNo: orNull(values.employeeNo),
    jobTitle: orNull(values.jobTitle),
    location: orNull(values.location),
    seniority: values.seniority === '' ? null : values.seniority,
    hireDate: orNull(values.hireDate),
    birthDate: orNull(values.birthDate),
    phone: orNull(values.phone),
    country: values.country === '' ? null : values.country.toUpperCase(),
  };
}

export const phoneFormSchema = z.object({
  phone: text(30)
    .min(1, { error: 'required' })
    .refine((value) => /^\+?[0-9][0-9 ()\-.]{4,29}$/.test(value), { error: 'invalidPhone' }),
});
export type PhoneFormValues = z.input<typeof phoneFormSchema>;

export const deactivateFormSchema = z.object({ terminationDate: dateText });
export type DeactivateFormValues = z.input<typeof deactivateFormSchema>;

export const inviteFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, { error: 'required' })
    .max(254, { error: 'tooLong' })
    .pipe(z.email({ error: 'email' })),
});
export type InviteFormValues = z.input<typeof inviteFormSchema>;
