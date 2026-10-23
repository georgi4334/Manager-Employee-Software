import { describe, expect, it } from 'vitest';
import {
  MAX_EMPLOYEE_PAGE_SIZE,
  createEmployeeRequestSchema,
  dateOnlySchema,
  deactivateEmployeeRequestSchema,
  employeeQuerySchema,
  updateEmployeeRequestSchema,
  updateOwnEmployeeRequestSchema,
} from './employees.js';

const valid = { firstName: 'Ada', lastName: 'Lovelace', employmentType: 'full_time' as const };

describe('createEmployeeRequestSchema', () => {
  it('accepts the minimum and normalizes optional values', () => {
    expect(createEmployeeRequestSchema.parse(valid)).toEqual(valid);
    const parsed = createEmployeeRequestSchema.parse({
      ...valid,
      firstName: '  Ada ',
      email: ' Ada@Acme.EU ',
      jobTitle: '  Engineer ',
      location: '   ',
      country: 'bg',
      phone: '+359 88 123 4567',
      hireDate: '2024-02-29',
      seniority: 'senior',
    });
    expect(parsed).toMatchObject({
      firstName: 'Ada',
      email: 'ada@acme.eu',
      jobTitle: 'Engineer',
      location: null,
      country: 'BG',
    });
  });

  it.each([
    ['a missing first name', { ...valid, firstName: undefined }],
    ['a blank last name', { ...valid, lastName: '   ' }],
    ['a 101 character name', { ...valid, firstName: 'a'.repeat(101) }],
    ['an unknown employment type', { ...valid, employmentType: 'volunteer' }],
    ['an unknown seniority', { ...valid, seniority: 'god' }],
    ['a bad email', { ...valid, email: 'nope' }],
    ['a bad phone', { ...valid, phone: 'call me' }],
    ['a three letter country', { ...valid, country: 'BGR' }],
    ['a non-existent date', { ...valid, hireDate: '2026-02-30' }],
    ['a date before 1970 as hire date', { ...valid, hireDate: '1969-12-31' }],
    ['a birth date in the future', { ...valid, birthDate: '2999-01-01' }],
    ['a birth date before 1900', { ...valid, birthDate: '1899-12-31' }],
    ['a date in the wrong format', { ...valid, hireDate: '01.02.2024' }],
    ['unknown fields (mass assignment)', { ...valid, status: 'inactive' }],
    ['a user id (mass assignment)', { ...valid, userId: '0192f5a0-0000-7000-8000-00000000000a' }],
  ])('rejects %s', (_label, body) => {
    expect(createEmployeeRequestSchema.safeParse(body).success).toBe(false);
  });

  it('accepts a hire date today and a leap day', () => {
    expect(dateOnlySchema.safeParse('2024-02-29').success).toBe(true);
    expect(dateOnlySchema.safeParse('2023-02-29').success).toBe(false);
  });
});

describe('updateEmployeeRequestSchema', () => {
  it('allows partial updates and null to clear optional values', () => {
    expect(updateEmployeeRequestSchema.parse({ phone: null, seniority: null })).toEqual({
      phone: null,
      seniority: null,
    });
    expect(updateEmployeeRequestSchema.parse({ jobTitle: '' })).toEqual({ jobTitle: null });
  });

  it.each([
    ['an empty update', {}],
    ['a blank required name', { firstName: '' }],
    ['null for a required field', { lastName: null }],
    ['an email change', { email: 'x@y.eu' }],
    ['a status change', { status: 'inactive' }],
  ])('rejects %s', (_label, body) => {
    expect(updateEmployeeRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('updateOwnEmployeeRequestSchema', () => {
  it('only accepts the phone number', () => {
    expect(updateOwnEmployeeRequestSchema.parse({ phone: '+49 30 1234567' })).toEqual({
      phone: '+49 30 1234567',
    });
    expect(
      updateOwnEmployeeRequestSchema.safeParse({ phone: '+49 30 1234567', jobTitle: 'CEO' })
        .success,
    ).toBe(false);
    expect(updateOwnEmployeeRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('deactivateEmployeeRequestSchema', () => {
  it('accepts an optional termination date only', () => {
    expect(deactivateEmployeeRequestSchema.parse({})).toEqual({});
    expect(deactivateEmployeeRequestSchema.parse({ terminationDate: '2026-10-31' })).toEqual({
      terminationDate: '2026-10-31',
    });
    expect(deactivateEmployeeRequestSchema.safeParse({ terminationDate: 'soon' }).success).toBe(
      false,
    );
    expect(deactivateEmployeeRequestSchema.safeParse({ status: 'active' }).success).toBe(false);
  });
});

describe('employeeQuerySchema', () => {
  it('applies defaults and coerces numbers from the query string', () => {
    expect(employeeQuerySchema.parse({})).toEqual({ status: 'active', page: 1, pageSize: 50 });
    expect(employeeQuerySchema.parse({ page: '2', pageSize: '10', q: ' ada ' })).toEqual({
      q: 'ada',
      status: 'active',
      page: 2,
      pageSize: 10,
    });
  });

  it.each([
    ['page 0', { page: '0' }],
    ['a page size over the limit', { pageSize: String(MAX_EMPLOYEE_PAGE_SIZE + 1) }],
    ['a non-numeric page', { page: 'x' }],
    ['an unknown status', { status: 'deleted' }],
    ['a too long search', { q: 'a'.repeat(101) }],
  ])('rejects %s', (_label, query) => {
    expect(employeeQuerySchema.safeParse(query).success).toBe(false);
  });
});
