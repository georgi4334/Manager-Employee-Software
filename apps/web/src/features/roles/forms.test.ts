import { PERMISSIONS, roleRequestSchema, type RoleDetail } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  copyGrants,
  emptyRole,
  grantsToMap,
  mayGrant,
  roleFormSchema,
  scopesFor,
  toRequest,
  valuesOf,
} from './forms';

const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));

const role: RoleDetail = {
  id: '0192f5a0-0000-7000-8000-000000000001',
  key: null,
  name: 'Payroll clerk',
  description: 'Handles pay',
  isSystem: false,
  grants: [
    { code: 'compensation.view', scope: 'all' },
    { code: 'leave.approve', scope: 'team' },
  ],
  userCount: 2,
  parentId: null,
};

describe('role form', () => {
  it('round-trips a role through the form and maps to what the API accepts', () => {
    const values = valuesOf(role);
    expect(values).toEqual({
      name: 'Payroll clerk',
      description: 'Handles pay',
      grants: { 'compensation.view': 'all', 'leave.approve': 'team' },
      parentId: '',
    });
    expect(roleFormSchema.safeParse(values).success).toBe(true);
    const body = toRequest(values);
    expect(body.grants).toEqual([
      { code: 'compensation.view', scope: 'all' },
      { code: 'leave.approve', scope: 'team' },
    ]);
    expect(roleRequestSchema.safeParse(body).success).toBe(true);
  });

  it('sends the grants in catalog order, trims text and leaves out an empty description', () => {
    const body = toRequest({
      name: '  Clerk ',
      description: '  ',
      grants: { 'leave.approve': 'all', 'employee.create': 'all' },
      parentId: '',
    });
    expect(body.name).toBe('Clerk');
    expect(body).not.toHaveProperty('description');
    expect(body.grants.map((g) => g.code)).toEqual(
      PERMISSIONS.map((p) => p.code).filter(
        (c) => c === 'employee.create' || c === 'leave.approve',
      ),
    );
  });

  it('sends the place in the tree: empty is the top level', () => {
    const parent = '0192f5a0-0000-7000-8000-000000000009';
    expect(toRequest({ ...valuesOf(role), parentId: '' }).parentId).toBeNull();
    expect(toRequest({ ...valuesOf(role), parentId: parent }).parentId).toBe(parent);
    expect(valuesOf({ ...role, parentId: parent }).parentId).toBe(parent);
    expect(
      roleRequestSchema.safeParse(toRequest({ ...valuesOf(role), parentId: parent })).success,
    ).toBe(true);
  });

  it('leaves out "no access", unknown permissions and scopes the permission does not allow', () => {
    const body = toRequest({
      name: 'X',
      description: '',
      grants: {
        'leave.approve': '',
        'payroll.run': 'all',
        'admin.role.manage': 'own', // only "all" is allowed
        'employee.create': 'all',
      },
      parentId: '',
    });
    expect(body.grants).toEqual([{ code: 'employee.create', scope: 'all' }]);
    expect(roleRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['no name', { name: ' ' }, ['name:required']],
    ['a long name', { name: 'x'.repeat(61) }, ['name:tooLong']],
    ['a long description', { description: 'x'.repeat(201) }, ['description:tooLong']],
  ])('refuses %s with a translated message key, as the API does', (_label, patch, expected) => {
    const values = { ...emptyRole(), name: 'Ok', ...patch };
    expect(issues(roleFormSchema.safeParse(values))).toEqual(expected);
    expect(roleRequestSchema.safeParse(toRequest(values)).success).toBe(false);
  });

  it('offers exactly the scopes the catalog allows', () => {
    expect(scopesFor('admin.role.manage')).toEqual(['all']);
    expect(scopesFor('leave.approve')).toEqual(['own', 'reports', 'team', 'department', 'all']);
  });
});

describe('what the user may hand out', () => {
  const mine = { 'leave.approve': 'team', 'goal.view': 'all' } as const;

  it('allows the held scope and narrower ones only', () => {
    expect(mayGrant(mine, 'leave.approve', 'team')).toBe(true);
    expect(mayGrant(mine, 'leave.approve', 'own')).toBe(true);
    expect(mayGrant(mine, 'leave.approve', 'department')).toBe(false);
    expect(mayGrant(mine, 'leave.approve', 'all')).toBe(false);
    expect(mayGrant(mine, 'goal.view', 'all')).toBe(true);
  });

  it('refuses permissions that are not held, and everything while nothing is known', () => {
    expect(mayGrant(mine, 'employee.create', 'all')).toBe(false);
    expect(mayGrant(undefined, 'leave.approve', 'own')).toBe(false);
  });

  it('copies only the grants that may be handed out', () => {
    const copied = copyGrants(
      [
        { code: 'leave.approve', scope: 'all' },
        { code: 'leave.approve', scope: 'own' },
        { code: 'goal.view', scope: 'all' },
        { code: 'employee.create', scope: 'all' },
        { code: 'payroll.run', scope: 'all' },
      ] as never,
      mine,
    );
    // the second leave.approve is the narrower duplicate, the later entry wins in the map
    expect(copied).toEqual({ 'leave.approve': 'own', 'goal.view': 'all' });
    expect(grantsToMap([])).toEqual({});
  });
});
