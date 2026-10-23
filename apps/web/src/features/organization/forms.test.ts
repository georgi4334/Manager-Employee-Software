import {
  assignmentRequestSchema,
  createDepartmentRequestSchema,
  createTeamRequestSchema,
} from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  assignmentFormSchema,
  departmentFormSchema,
  teamFormSchema,
  toAssignmentRequest,
  toDepartmentRequest,
  toTeamRequest,
} from './forms';

const ID = '0192f5a0-0000-7000-8000-00000000000a';

const issues = (result: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) =>
  result.success ? [] : (result.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []);

describe('department form', () => {
  it('needs a name and maps "nobody" to null for the API', () => {
    expect(
      issues(departmentFormSchema.safeParse({ name: '  ', parentId: '', headEmployeeId: '' })),
    ).toEqual(['name:required']);
    const request = toDepartmentRequest({ name: ' Eng ', parentId: '', headEmployeeId: ID });
    expect(request).toEqual({ name: 'Eng', parentId: null, headEmployeeId: ID });
    expect(createDepartmentRequestSchema.safeParse(request).success).toBe(true);
  });

  it('flags names over 100 characters like the API', () => {
    const name = 'a'.repeat(101);
    expect(
      issues(departmentFormSchema.safeParse({ name, parentId: '', headEmployeeId: '' })),
    ).toEqual(['name:tooLong']);
    expect(createDepartmentRequestSchema.safeParse({ name }).success).toBe(false);
  });
});

describe('team form', () => {
  it('needs a name and a department', () => {
    expect(
      issues(teamFormSchema.safeParse({ name: '', departmentId: '', leadEmployeeId: '' })).sort(),
    ).toEqual(['departmentId:required', 'name:required']);
    const request = toTeamRequest({ name: 'Backend', departmentId: ID, leadEmployeeId: '' });
    expect(request).toEqual({ name: 'Backend', departmentId: ID, leadEmployeeId: null });
    expect(createTeamRequestSchema.safeParse(request).success).toBe(true);
  });
});

describe('assignment form', () => {
  it('always sends both values, null meaning nobody', () => {
    const request = toAssignmentRequest({ managerId: '', departmentId: ID });
    expect(request).toEqual({ managerId: null, departmentId: ID });
    expect(assignmentRequestSchema.safeParse(request).success).toBe(true);
    expect(assignmentFormSchema.safeParse({ managerId: '', departmentId: '' }).success).toBe(true);
  });
});
