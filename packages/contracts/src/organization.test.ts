import { describe, expect, it } from 'vitest';
import {
  MAX_TEAM_MEMBERS,
  assignmentRequestSchema,
  buildChartTree,
  createDepartmentRequestSchema,
  createTeamRequestSchema,
  setTeamMembersRequestSchema,
  updateDepartmentRequestSchema,
  updateTeamRequestSchema,
  type ChartNode,
} from './organization.js';

const A = '0192f5a0-0000-7000-8000-00000000000a';
const B = '0192f5a0-0000-7000-8000-00000000000b';

describe('department and team requests', () => {
  it('accepts a name and optional ids, trimming the name', () => {
    expect(createDepartmentRequestSchema.parse({ name: '  Engineering ' })).toEqual({
      name: 'Engineering',
    });
    expect(
      createDepartmentRequestSchema.parse({ name: 'QA', parentId: A, headEmployeeId: null }),
    ).toEqual({ name: 'QA', parentId: A, headEmployeeId: null });
    expect(createTeamRequestSchema.parse({ name: 'Backend', departmentId: A })).toEqual({
      name: 'Backend',
      departmentId: A,
    });
  });

  it.each([
    ['a blank department name', () => createDepartmentRequestSchema.safeParse({ name: '  ' })],
    [
      'a 101 character name',
      () => createDepartmentRequestSchema.safeParse({ name: 'a'.repeat(101) }),
    ],
    [
      'a non-uuid parent',
      () => createDepartmentRequestSchema.safeParse({ name: 'x', parentId: 'root' }),
    ],
    ['an unknown field', () => createDepartmentRequestSchema.safeParse({ name: 'x', tenantId: A })],
    ['a team without department', () => createTeamRequestSchema.safeParse({ name: 'x' })],
    ['an empty department update', () => updateDepartmentRequestSchema.safeParse({})],
    ['an empty team update', () => updateTeamRequestSchema.safeParse({})],
    ['null as team department', () => updateTeamRequestSchema.safeParse({ departmentId: null })],
  ])('rejects %s', (_label, run) => {
    expect(run().success).toBe(false);
  });

  it('allows clearing optional links with null', () => {
    expect(updateDepartmentRequestSchema.parse({ parentId: null })).toEqual({ parentId: null });
    expect(updateTeamRequestSchema.parse({ leadEmployeeId: null })).toEqual({
      leadEmployeeId: null,
    });
  });
});

describe('setTeamMembersRequestSchema', () => {
  it('accepts a list, including an empty one, up to the limit', () => {
    expect(setTeamMembersRequestSchema.safeParse({ employeeIds: [] }).success).toBe(true);
    expect(setTeamMembersRequestSchema.safeParse({ employeeIds: [A, B] }).success).toBe(true);
  });

  it.each([
    ['duplicates', { employeeIds: [A, A] }],
    ['a non-uuid', { employeeIds: ['x'] }],
    [
      'too many',
      {
        employeeIds: Array.from(
          { length: MAX_TEAM_MEMBERS + 1 },
          (_, i) => `0192f5a0-0000-7000-8000-${String(i).padStart(12, '0')}`,
        ),
      },
    ],
    ['a missing list', {}],
  ])('rejects %s', (_label, body) => {
    expect(setTeamMembersRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('assignmentRequestSchema', () => {
  it('needs both values, each an id or null', () => {
    expect(assignmentRequestSchema.safeParse({ managerId: A, departmentId: null }).success).toBe(
      true,
    );
    expect(assignmentRequestSchema.safeParse({ managerId: A }).success).toBe(false);
    expect(assignmentRequestSchema.safeParse({ managerId: 'me', departmentId: null }).success).toBe(
      false,
    );
    expect(
      assignmentRequestSchema.safeParse({ managerId: A, departmentId: null, status: 'x' }).success,
    ).toBe(false);
  });
});

describe('buildChartTree', () => {
  const node = (id: string, last: string, managerId: string | null): ChartNode => ({
    id,
    firstName: 'F',
    lastName: last,
    jobTitle: null,
    managerId,
    departmentId: null,
  });

  it('nests reports under their manager, sorted by name', () => {
    const tree = buildChartTree([
      node('c', 'Zed', 'a'),
      node('a', 'Boss', null),
      node('b', 'Abe', 'a'),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.node.id).toBe('a');
    expect(tree[0]?.reports.map((r) => r.node.id)).toEqual(['b', 'c']);
  });

  it('turns people whose manager is missing into roots and handles an empty list', () => {
    expect(buildChartTree([])).toEqual([]);
    const tree = buildChartTree([node('x', 'Orphan', 'gone'), node('y', 'Root', null)]);
    expect(tree.map((t) => t.node.id)).toEqual(['x', 'y']);
  });

  it('never loops or loses people on corrupt data (a cycle)', () => {
    const tree = buildChartTree([node('a', 'A', 'b'), node('b', 'B', 'a'), node('r', 'R', null)]);
    const count = (list: typeof tree): number => list.reduce((n, t) => n + 1 + count(t.reports), 0);
    expect(count(tree)).toBe(1); // only the real root: cyclic nodes are unreachable, nothing hangs
  });
});
