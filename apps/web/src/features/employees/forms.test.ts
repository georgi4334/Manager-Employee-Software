import {
  createEmployeeRequestSchema,
  updateEmployeeRequestSchema,
  updateOwnEmployeeRequestSchema,
} from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_EMPLOYEE_FORM,
  deactivateFormSchema,
  employeeFormSchema,
  inviteFormSchema,
  phoneFormSchema,
  toCreateRequest,
  toUpdateRequest,
  type EmployeeFormValues,
} from './forms';

const filled: EmployeeFormValues = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: ' Ada@Acme.EU ',
  employeeNo: 'E-1',
  jobTitle: 'Engineer',
  location: 'Sofia',
  employmentType: 'part_time',
  seniority: 'senior',
  hireDate: '2024-02-29',
  birthDate: '1990-12-10',
  phone: '+359 88 123 4567',
  country: 'bg',
};

const problems = (values: Partial<EmployeeFormValues>) => {
  const result = employeeFormSchema.safeParse({
    ...EMPTY_EMPLOYEE_FORM,
    firstName: 'A',
    lastName: 'B',
    ...values,
  });
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}:${i.message}`);
};

describe('employeeFormSchema', () => {
  it('accepts a complete and a minimal form', () => {
    expect(employeeFormSchema.safeParse(filled).success).toBe(true);
    expect(problems({})).toEqual([]);
  });

  it('requires both names', () => {
    expect(problems({ firstName: '  ', lastName: '' }).sort()).toEqual([
      'firstName:required',
      'lastName:required',
    ]);
  });

  it.each([
    [{ email: 'nope' }, 'email:email'],
    [{ hireDate: '01.02.2024' }, 'hireDate:invalidDate'],
    [{ birthDate: '2999-01-01' }, 'birthDate:futureDate'],
    [{ phone: 'call me' }, 'phone:invalidPhone'],
    [{ country: 'BGR' }, 'country:tooLong'],
    [{ country: 'B1' }, 'country:invalidCountry'],
    [{ firstName: 'a'.repeat(101) }, 'firstName:tooLong'],
  ])('rejects %j', (values, expected) => {
    expect(problems(values)).toContain(expected);
  });
});

describe('request mapping', () => {
  it('builds a create request the API accepts, leaving empty optional values out', () => {
    const request = toCreateRequest(filled);
    expect(request.email).toBe('ada@acme.eu');
    expect(createEmployeeRequestSchema.safeParse(request).success).toBe(true);

    const minimal = toCreateRequest({ ...EMPTY_EMPLOYEE_FORM, firstName: 'A', lastName: 'B' });
    expect(createEmployeeRequestSchema.parse(minimal)).toMatchObject({
      firstName: 'A',
      employmentType: 'full_time',
    });
    expect(Object.values(minimal).filter((v) => v === '')).toEqual([]);
  });

  it('builds an update request the API accepts, turning empty values into null', () => {
    const request = toUpdateRequest(filled);
    expect(updateEmployeeRequestSchema.safeParse(request).success).toBe(true);
    expect(request.country).toBe('BG');

    const cleared = toUpdateRequest({
      ...filled,
      jobTitle: '',
      seniority: '',
      phone: '',
      country: '',
    });
    expect(cleared).toMatchObject({ jobTitle: null, seniority: null, phone: null, country: null });
    expect(updateEmployeeRequestSchema.safeParse(cleared).success).toBe(true);
  });
});

describe('small forms', () => {
  it('phone: required and shaped like the API expects', () => {
    expect(phoneFormSchema.safeParse({ phone: '' }).success).toBe(false);
    expect(phoneFormSchema.safeParse({ phone: 'abc' }).success).toBe(false);
    expect(phoneFormSchema.safeParse({ phone: '+49 30 1234567' }).success).toBe(true);
    expect(updateOwnEmployeeRequestSchema.safeParse({ phone: '+49 30 1234567' }).success).toBe(
      true,
    );
  });

  it('deactivate: the date is optional but must be a date', () => {
    expect(deactivateFormSchema.safeParse({ terminationDate: '' }).success).toBe(true);
    expect(deactivateFormSchema.safeParse({ terminationDate: '2026-10-31' }).success).toBe(true);
    expect(deactivateFormSchema.safeParse({ terminationDate: 'soon' }).success).toBe(false);
  });

  it('invite: needs a valid email', () => {
    expect(inviteFormSchema.safeParse({ email: '' }).success).toBe(false);
    expect(inviteFormSchema.safeParse({ email: 'nope' }).success).toBe(false);
    expect(inviteFormSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
  });
});
