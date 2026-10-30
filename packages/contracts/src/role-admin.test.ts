import { describe, expect, it } from 'vitest';
import {
  MAX_ROLE_NAME,
  SYSTEM_ROLE_PARENTS,
  buildRoleTree,
  descendantIds,
  diffGrants,
  escalations,
  roleParentRequestSchema,
  roleRequestSchema,
  wouldCycle,
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

const A = '0192f5a0-0000-7000-8000-00000000000a';
const B = '0192f5a0-0000-7000-8000-00000000000b';
const C = '0192f5a0-0000-7000-8000-00000000000c';
const D = '0192f5a0-0000-7000-8000-00000000000d';

describe('role tree (ADR 0036)', () => {
  const role = (id: string, parentId: string | null, name: string, key: string | null = null) => ({
    id,
    parentId,
    name,
    key,
    isSystem: key !== null,
  });
  // A (admin) > B (hr) > C (custom) ; D (custom) root
  const roles = [
    role(C, B, 'Team lead'),
    role(A, null, 'Admin', 'admin'),
    role(D, null, 'Contractor'),
    role(B, A, 'HR', 'hr'),
  ];

  it('parent requests take a uuid or null, nothing else', () => {
    expect(roleParentRequestSchema.safeParse({ parentId: A }).success).toBe(true);
    expect(roleParentRequestSchema.safeParse({ parentId: null }).success).toBe(true);
    expect(roleParentRequestSchema.safeParse({}).success).toBe(false);
    expect(roleParentRequestSchema.safeParse({ parentId: 'x' }).success).toBe(false);
    expect(roleParentRequestSchema.safeParse({ parentId: null, extra: 1 }).success).toBe(false);
    expect(roleRequestSchema.safeParse({ ...ok, parentId: A }).success).toBe(true);
    expect(roleRequestSchema.safeParse({ ...ok, parentId: 'x' }).success).toBe(false);
  });

  it('refuses a role under itself or under one of its descendants', () => {
    expect(wouldCycle(roles, A, A)).toBe(true);
    expect(wouldCycle(roles, A, C)).toBe(true);
    expect(wouldCycle(roles, B, C)).toBe(true);
    expect(wouldCycle(roles, C, A)).toBe(false);
    expect(wouldCycle(roles, A, D)).toBe(false);
    expect(wouldCycle(roles, A, null)).toBe(false);
    expect(wouldCycle(roles, D, 'unknown')).toBe(false);
  });

  it('never runs forever on a chain that already loops', () => {
    const loop = [role(A, B, 'a'), role(B, A, 'b')];
    expect(wouldCycle(loop, C, A)).toBe(true);
  });

  it('lists every descendant', () => {
    expect([...descendantIds(roles, A)].sort()).toEqual([B, C]);
    expect([...descendantIds(roles, C)]).toEqual([]);
  });

  it('builds the tree with system roles first and names after', () => {
    const tree = buildRoleTree(roles);
    expect(tree.map((n) => n.role.name)).toEqual(['Admin', 'Contractor']);
    expect(tree[0]!.children.map((n) => n.role.name)).toEqual(['HR']);
    expect(tree[0]!.children[0]!.children.map((n) => n.role.name)).toEqual(['Team lead']);
  });

  it('shows roles with an unknown parent or caught in a loop as roots, each once', () => {
    const odd = [role(A, B, 'a'), role(B, A, 'b'), role(C, 'gone', 'c')];
    const tree = buildRoleTree(odd);
    const all: string[] = [];
    const walk = (nodes: typeof tree) =>
      nodes.forEach((n) => {
        all.push(n.role.id);
        walk(n.children);
      });
    walk(tree);
    expect(all.sort()).toEqual([A, B, C]);
    expect(tree.map((n) => n.role.id)).toContain(C);
  });

  it('starts new workspaces with Admin > HR > Manager > Employee', () => {
    expect(SYSTEM_ROLE_PARENTS).toEqual({
      admin: null,
      hr: 'admin',
      manager: 'hr',
      employee: 'manager',
    });
  });
});
