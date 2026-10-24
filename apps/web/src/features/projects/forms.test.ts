import {
  createAssignmentRequestSchema,
  createClientRequestSchema,
  createMilestoneRequestSchema,
  createProjectRequestSchema,
  updateAssignmentRequestSchema,
  updateClientRequestSchema,
  updateProjectRequestSchema,
} from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  assignmentFormSchema,
  clientFormSchema,
  emptyProject,
  milestoneFormSchema,
  projectFormSchema,
  toCreateAssignment,
  toCreateClient,
  toCreateProject,
  toMilestone,
  toUpdateAssignment,
  toUpdateClient,
  toUpdateProject,
  type AssignmentFormValues,
  type ClientFormValues,
  type ProjectFormValues,
} from './forms';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));

describe('project form', () => {
  const base: ProjectFormValues = {
    ...emptyProject('2026-11-02'),
    code: 'web-1',
    name: ' Website ',
    budgetHours: '120.5',
  };

  it('accepts a valid project and maps to what the API accepts', () => {
    expect(projectFormSchema.safeParse(base).success).toBe(true);
    const body = toCreateProject(base);
    expect(body).toMatchObject({
      code: 'web-1',
      name: 'Website',
      budgetHours: 120.5,
      status: 'planned',
    });
    expect(body).not.toHaveProperty('clientId');
    expect(body).not.toHaveProperty('leadEmployeeId');
    expect(createProjectRequestSchema.safeParse(body).success).toBe(true);
    const full = toCreateProject({
      ...base,
      clientId: ID,
      leadEmployeeId: ID,
      endDate: '2026-12-01',
      description: ' x ',
    });
    expect(createProjectRequestSchema.safeParse(full).success).toBe(true);
  });

  it.each([
    ['a short code', { code: 'A' }, ['code:invalidCode']],
    ['a code with spaces', { code: 'WE B' }, ['code:invalidCode']],
    ['no name', { name: ' ' }, ['name:required']],
    ['a long name', { name: 'x'.repeat(121) }, ['name:tooLong']],
    ['a budget in odd fractions', { budgetHours: '10.3' }, ['budgetHours:invalidHours']],
    ['a negative budget', { budgetHours: '-1' }, ['budgetHours:invalidHours']],
    ['a bad date', { startDate: '2.11.2026' }, ['startDate:invalidDate']],
    ['no start', { startDate: '' }, ['startDate:required']],
    ['an end before the start', { endDate: '2026-11-01' }, ['endDate:end_before_start']],
  ])('refuses %s, as the API does', (_label, patch, expected) => {
    const values = { ...base, ...patch };
    expect(issues(projectFormSchema.safeParse(values))).toEqual(expected);
    expect(createProjectRequestSchema.safeParse(toCreateProject(values)).success).toBe(false);
  });

  it('sends only what changed when editing, and clears with null', () => {
    const current = {
      ...base,
      code: 'WEB-1',
      name: 'Website',
      clientId: ID,
      endDate: '2026-12-01',
      leadEmployeeId: ID,
    };
    expect(toUpdateProject({ ...current, code: 'web-1' }, current)).toEqual({}); // same code, other case
    const changed = toUpdateProject(
      {
        ...current,
        name: 'New',
        clientId: '',
        endDate: '',
        budgetHours: '',
        description: '',
        leadEmployeeId: '',
      },
      current,
    );
    expect(changed).toEqual({
      name: 'New',
      clientId: null,
      endDate: null,
      budgetHours: null,
      leadEmployeeId: null,
    });
    expect(updateProjectRequestSchema.safeParse(changed).success).toBe(true);
    expect(toUpdateProject({ ...current, name: 'Only the name' }, current)).toEqual({
      name: 'Only the name',
    });
  });
});

describe('client form', () => {
  const base: ClientFormValues = {
    name: ' Initech ',
    contactName: '',
    contactEmail: ' Bill@Initech.EU ',
    notes: '',
  };
  it('maps to the API, dropping empty fields and clearing on update', () => {
    expect(clientFormSchema.safeParse(base).success).toBe(true);
    const body = toCreateClient(base);
    expect(body).toEqual({ name: 'Initech', contactEmail: 'bill@initech.eu' });
    expect(createClientRequestSchema.safeParse(body).success).toBe(true);
    const update = toUpdateClient(base);
    expect(update).toEqual({
      name: 'Initech',
      contactName: null,
      contactEmail: 'bill@initech.eu',
      notes: null,
    });
    expect(updateClientRequestSchema.safeParse(update).success).toBe(true);
  });
  it.each([
    ['no name', { name: ' ' }, ['name:required']],
    ['a bad email', { contactEmail: 'nope' }, ['contactEmail:email']],
    ['long notes', { notes: 'x'.repeat(1001) }, ['notes:tooLong']],
  ])('refuses %s', (_label, patch, expected) => {
    expect(issues(clientFormSchema.safeParse({ ...base, ...patch }))).toEqual(expected);
  });
});

describe('milestone form', () => {
  it('needs a title and a date and maps to the API', () => {
    expect(issues(milestoneFormSchema.safeParse({ title: ' ', dueDate: '' }))).toEqual([
      'title:required',
      'dueDate:required',
    ]);
    const body = toMilestone({ title: ' Beta ', dueDate: '2026-12-01' });
    expect(body).toEqual({ title: 'Beta', dueDate: '2026-12-01' });
    expect(createMilestoneRequestSchema.safeParse(body).success).toBe(true);
  });
});

describe('assignment form', () => {
  const base: AssignmentFormValues = {
    employeeId: ID,
    role: ' Dev ',
    allocationPct: '50',
    fromDate: '2026-11-02',
    toDate: '',
  };
  it('maps to what the API accepts', () => {
    expect(assignmentFormSchema.safeParse(base).success).toBe(true);
    const body = toCreateAssignment(base);
    expect(body).toEqual({
      employeeId: ID,
      role: 'Dev',
      allocationPct: 50,
      fromDate: '2026-11-02',
    });
    expect(createAssignmentRequestSchema.safeParse(body).success).toBe(true);
    const update = toUpdateAssignment({ ...base, role: '', toDate: '' });
    expect(update).toEqual({ role: null, allocationPct: 50, fromDate: '2026-11-02', toDate: null });
    expect(updateAssignmentRequestSchema.safeParse(update).success).toBe(true);
  });
  it.each([
    ['no person', { employeeId: '' }, ['employeeId:required']],
    ['zero allocation', { allocationPct: '0' }, ['allocationPct:invalidAllocation']],
    ['more than 100', { allocationPct: '101' }, ['allocationPct:invalidAllocation']],
    ['a fraction', { allocationPct: '12.5' }, ['allocationPct:invalidAllocation']],
    ['no allocation', { allocationPct: '' }, ['allocationPct:required']],
    ['an end before the start', { toDate: '2026-11-01' }, ['toDate:end_before_start']],
    ['a long role', { role: 'x'.repeat(61) }, ['role:tooLong']],
  ])('refuses %s, as the API does', (_label, patch, expected) => {
    const values = { ...base, ...patch };
    expect(issues(assignmentFormSchema.safeParse(values))).toEqual(expected);
    if (!('employeeId' in patch) && !('allocationPct' in patch && patch.allocationPct === '')) {
      expect(createAssignmentRequestSchema.safeParse(toCreateAssignment(values)).success).toBe(
        false,
      );
    }
  });
});
