import { describe, expect, it } from 'vitest';
import {
  MAX_ROLE_NAME,
  diffGrants,
  escalations,
  roleRequestSchema,
  type Grant,
} from './role-admin.js';

const ok = { name: 'Payroll clerk', grants: [{ code: 'leave.view', scope: 'all' }] };

describe('roleRequestSchema', () => {
  it('accepts a role and trims the name; an empty description becomes null', () => {
    const parsed = roleRequestSchema.parse({ ...ok, name: '  Clerk  ', description: '  ' });
    expect(parsed).toMatchObject({ name: 'Clerk', description: null });
    expect(roleRequestSchema.safeParse({ ...ok, grants: [] }).success).toBe(true);
  });

  it.each([
    ['no name', { name: ' ' }],
    ['a long name', { name: 'x'.repeat(MAX_ROLE_NAME + 1) }],
    ['a long description', { description: 'x'.repeat(201) }],
    ['an unknown permission', { grants: [{ code: 'payroll.run', scope: 'all' }] }],
    [
      'a scope the permission does not allow',
      { grants: [{ code: 'admin.role.manage', scope: 'own' }] },
    ],
    ['an unknown scope', { grants: [{ code: 'leave.view', scope: 'galaxy' }] }],
    [
      'the same permission twice',
      {
        grants: [
          { code: 'leave.view', scope: 'own' },
          { code: 'leave.view', scope: 'all' },
        ],
      },
    ],
    ['an extra field', { isSystem: true }],
  ])('refuses %s', (_label, patch) => {
    expect(roleRequestSchema.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
});

describe('escalations', () => {
  const g = (code: string, scope: Grant['scope']): Grant => ({ code, scope });
  const actor = { 'leave.view': 'team', 'leave.approve': 'all' } as const;

  it('allows what the actor holds at that scope or wider', () => {
    expect(escalations(actor, [], [g('leave.view', 'team'), g('leave.view', 'own')])).toEqual([]);
    expect(escalations(actor, [], [g('leave.approve', 'department')])).toEqual([]);
  });

  it('flags a wider scope and a permission the actor lacks', () => {
    expect(escalations(actor, [], [g('leave.view', 'all')])).toEqual([g('leave.view', 'all')]);
    expect(escalations(actor, [], [g('goal.view', 'own')])).toEqual([g('goal.view', 'own')]);
  });

  it('keeps what the role already had, even when the actor lacks it, but not a widening of it', () => {
    const had = [g('goal.view', 'team')];
    expect(escalations(actor, had, [g('goal.view', 'team')])).toEqual([]);
    expect(escalations(actor, had, [g('goal.view', 'own')])).toEqual([]);
    expect(escalations(actor, had, [g('goal.view', 'all')])).toEqual([g('goal.view', 'all')]);
  });

  it('never flags removals', () => {
    expect(escalations(actor, [g('goal.view', 'all')], [])).toEqual([]);
  });
});

describe('diffGrants', () => {
  it('lists added, changed and removed grants', () => {
    const before: Grant[] = [
      { code: 'a.x', scope: 'own' },
      { code: 'b.y', scope: 'all' },
      { code: 'c.z', scope: 'team' },
    ];
    const after: Grant[] = [
      { code: 'a.x', scope: 'all' },
      { code: 'c.z', scope: 'team' },
      { code: 'd.w', scope: 'own' },
    ];
    expect(diffGrants(before, after)).toEqual({
      added: [{ code: 'd.w', scope: 'own' }],
      changed: [{ code: 'a.x', scope: 'all' }],
      removed: [{ code: 'b.y', scope: 'all' }],
    });
    expect(diffGrants(before, before)).toEqual({ added: [], changed: [], removed: [] });
  });
});
