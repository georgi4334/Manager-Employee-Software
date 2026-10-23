import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MATRIX_END,
  MATRIX_START,
  PERMISSIONS,
  PERMISSION_CODES,
  PERMISSION_MODULES,
  hasPermission,
  isPermissionCode,
  isValidGrant,
  mergeGrants,
  renderPermissionMatrix,
  scopeCovers,
  systemRoleGrants,
  widerScope,
  type PermissionDef,
} from './permissions.js';
import { PERMISSION_SCOPES, SYSTEM_ROLES, type PermissionScope, type SystemRole } from './roles.js';

const grantOf = (code: string, role: SystemRole): PermissionScope | undefined =>
  (PERMISSIONS.find((p) => p.code === code)?.grants as PermissionDef['grants'] | undefined)?.[role];

describe('catalog integrity', () => {
  it('has unique, well-formed codes and known modules', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSIONS.length);
    for (const permission of PERMISSIONS) {
      expect(permission.code).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
      expect(PERMISSION_MODULES).toContain(permission.module);
      expect(permission.description.trim().length).toBeGreaterThan(5);
    }
  });

  it('only grants scopes that the permission allows (a scope like "team" on a self-only permission is a bug)', () => {
    for (const permission of PERMISSIONS) {
      for (const [role, scope] of Object.entries(permission.grants)) {
        expect(permission.scopes, `${permission.code} for ${role}`).toContain(scope);
      }
    }
  });

  it('only grants to the four system roles', () => {
    for (const permission of PERMISSIONS) {
      for (const role of Object.keys(permission.grants)) expect(SYSTEM_ROLES).toContain(role);
    }
  });

  it('every permission is held by at least one role (no dead permissions)', () => {
    for (const permission of PERMISSIONS) {
      expect(Object.keys(permission.grants).length, permission.code).toBeGreaterThan(0);
    }
  });
});

describe('the rules written in docs/permission-matrix.md hold in the catalog', () => {
  const broadForEmployee = new Set([
    'employee.view_directory',
    'org.view',
    'feedback.give',
    'calendar.view_free_busy',
  ]);

  it('employees see little: everything beyond their own records is a short, explicit list', () => {
    for (const permission of PERMISSIONS) {
      const scope = grantOf(permission.code, 'employee');
      if (scope && scope !== 'own')
        expect(broadForEmployee, permission.code).toContain(permission.code);
    }
  });

  it('managers never reach beyond their team, except directory-like permissions', () => {
    const allowed = new Set([...broadForEmployee, 'client.view']);
    for (const permission of PERMISSIONS) {
      const scope = grantOf(permission.code, 'manager');
      if (scope === 'all' || scope === 'department')
        expect(allowed, permission.code).toContain(permission.code);
    }
  });

  it('salary and compensation: HR and Admin only', () => {
    for (const code of ['compensation.view', 'compensation.manage']) {
      expect(grantOf(code, 'employee')).toBeUndefined();
      expect(grantOf(code, 'manager')).toBeUndefined();
      expect(grantOf(code, 'hr')).toBe('all');
      expect(grantOf(code, 'admin')).toBe('all');
    }
  });

  it('managers see reviews of their reports only, employees only their own', () => {
    expect(grantOf('review.view', 'manager')).toBe('reports');
    expect(grantOf('review.view', 'employee')).toBe('own');
    expect(grantOf('review.calibrate', 'manager')).toBeUndefined();
  });

  it('1:1 notes are private: no HR/Admin grant and no permission that reads everyone’s 1:1s', () => {
    expect(grantOf('one_on_one.manage', 'hr')).toBeUndefined();
    expect(grantOf('one_on_one.manage', 'admin')).toBeUndefined();
    expect(PERMISSION_CODES.filter((code) => code.startsWith('one_on_one.'))).toEqual([
      'one_on_one.manage',
    ]);
  });

  it('assigning roles is Admin-only; inviting and disabling users is HR and Admin', () => {
    for (const code of ['admin.role.assign', 'admin.role.manage', 'admin.tenant.settings']) {
      expect(grantOf(code, 'admin')).toBe('all');
      expect(grantOf(code, 'hr')).toBeUndefined();
    }
    for (const code of [
      'admin.user.invite',
      'admin.user.disable',
      'admin.user.view',
      'admin.role.view',
    ]) {
      expect(grantOf(code, 'hr')).toBe('all');
      expect(grantOf(code, 'admin')).toBe('all');
      expect(grantOf(code, 'manager')).toBeUndefined();
      expect(grantOf(code, 'employee')).toBeUndefined();
    }
  });

  it('personal-action permissions are own-only for everyone, including Admin', () => {
    for (const code of [
      'attendance.record',
      'leave.request',
      'time.log',
      'timesheet.submit',
      'review.write_self',
      'gdpr.export_own',
    ]) {
      for (const role of SYSTEM_ROLES) expect(grantOf(code, role), `${code} ${role}`).toBe('own');
    }
  });

  it('Admin can do everything HR can (at least as wide), except where privacy deliberately excludes Admin', () => {
    const rank = (scope?: PermissionScope) => (scope ? PERMISSION_SCOPES.indexOf(scope) : -1);
    const privacyExceptions = new Set(['feedback.view_received']);
    for (const permission of PERMISSIONS) {
      if (privacyExceptions.has(permission.code)) continue;
      expect(rank(grantOf(permission.code, 'admin')), permission.code).toBeGreaterThanOrEqual(
        rank(grantOf(permission.code, 'hr')),
      );
    }
  });
});

describe('isPermissionCode / isValidGrant', () => {
  it('recognizes catalog codes only', () => {
    expect(isPermissionCode('leave.approve')).toBe(true);
    for (const value of [
      'leave.approve ',
      'LEAVE.APPROVE',
      'leave',
      '',
      null,
      undefined,
      1,
      'constructor',
      '__proto__',
    ]) {
      expect(isPermissionCode(value)).toBe(false);
    }
  });

  it('accepts allowed scopes and rejects everything else', () => {
    expect(isValidGrant('leave.approve', 'reports')).toBe(true);
    expect(isValidGrant('employee.create', 'all')).toBe(true);
    expect(isValidGrant('employee.create', 'own')).toBe(false); // all-only permission
    expect(isValidGrant('attendance.record', 'all')).toBe(false); // own-only permission
    expect(isValidGrant('leave.approve', 'everything')).toBe(false);
    expect(isValidGrant('nope.nope', 'all')).toBe(false);
    expect(isValidGrant(undefined, 'all')).toBe(false);
  });
});

describe('scopes', () => {
  it('widerScope picks the broader scope in either order', () => {
    expect(widerScope('own', 'team')).toBe('team');
    expect(widerScope('all', 'reports')).toBe('all');
    expect(widerScope('department', 'department')).toBe('department');
  });

  it.each([
    [
      'own',
      {
        self: true,
        direct_report: false,
        subordinate: false,
        same_department: false,
        other: false,
      },
    ],
    [
      'reports',
      { self: true, direct_report: true, subordinate: false, same_department: false, other: false },
    ],
    [
      'team',
      { self: true, direct_report: true, subordinate: true, same_department: false, other: false },
    ],
    [
      'department',
      { self: true, direct_report: true, subordinate: true, same_department: true, other: false },
    ],
    [
      'all',
      { self: true, direct_report: true, subordinate: true, same_department: true, other: true },
    ],
  ] as const)('scope %s covers exactly the right relations', (scope, expected) => {
    for (const [relation, covered] of Object.entries(expected)) {
      expect(scopeCovers(scope, relation as keyof typeof expected), `${scope} / ${relation}`).toBe(
        covered,
      );
    }
  });
});

describe('mergeGrants', () => {
  it('keeps the widest scope per permission across roles', () => {
    const merged = mergeGrants([
      [{ code: 'leave.view', scope: 'own' }],
      [
        { code: 'leave.view', scope: 'team' },
        { code: 'leave.approve', scope: 'reports' },
      ],
    ]);
    expect(merged).toEqual({ 'leave.view': 'team', 'leave.approve': 'reports' });
  });

  it('drops unknown codes and scopes the permission does not allow (fail closed)', () => {
    const merged = mergeGrants([
      [
        { code: 'made.up', scope: 'all' },
        { code: 'employee.create', scope: 'own' },
        { code: 'leave.view', scope: 'galaxy' },
        { code: 'leave.request', scope: 'own' },
      ],
    ]);
    expect(merged).toEqual({ 'leave.request': 'own' });
  });

  it('returns nothing for no roles', () => {
    expect(mergeGrants([])).toEqual({});
  });
});

describe('systemRoleGrants and hasPermission', () => {
  it('derives each role’s grants from the catalog', () => {
    const admin = systemRoleGrants('admin');
    expect(admin.find((g) => g.code === 'admin.role.assign')).toEqual({
      code: 'admin.role.assign',
      scope: 'all',
    });
    expect(systemRoleGrants('employee').some((g) => g.code.startsWith('admin.'))).toBe(false);
    for (const role of SYSTEM_ROLES) expect(systemRoleGrants(role).length).toBeGreaterThan(5);
  });

  it('hasPermission compares scopes and treats missing grants as denied', () => {
    const granted = { 'leave.view': 'team', 'leave.request': 'own' } as const;
    expect(hasPermission(granted, 'leave.view')).toBe(true);
    expect(hasPermission(granted, 'leave.view', 'reports')).toBe(true);
    expect(hasPermission(granted, 'leave.view', 'all')).toBe(false);
    expect(hasPermission(granted, 'leave.approve')).toBe(false);
    expect(hasPermission(undefined, 'leave.view')).toBe(false);
    expect(hasPermission({}, 'leave.view')).toBe(false);
  });
});

describe('docs/permission-matrix.md', () => {
  const docUrl = new URL('../../../docs/permission-matrix.md', import.meta.url);

  it('contains the matrix generated from the catalog (run `pnpm --filter @intime/contracts docs:permissions`)', () => {
    const doc = readFileSync(docUrl, 'utf8');
    const start = doc.indexOf(MATRIX_START);
    const end = doc.indexOf(MATRIX_END);
    expect(start, 'start marker').toBeGreaterThanOrEqual(0);
    expect(end, 'end marker').toBeGreaterThan(start);
    const block = doc.slice(start + MATRIX_START.length, end).trim();
    expect(block).toBe(renderPermissionMatrix());
  });

  it('lists every permission exactly once', () => {
    const table = renderPermissionMatrix();
    for (const code of PERMISSION_CODES)
      expect(table.split(`\`${code}\``).length - 1, code).toBe(1);
  });
});
