import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  AUDIT_AREAS,
  AUDIT_AREA_KEYS,
  auditAreaOf,
  auditQuerySchema,
  visibleAuditAreas,
} from './audit.js';
import { PERMISSIONS, systemRoleGrants, type GrantedPermissions } from './permissions.js';

const grantsOf = (role: 'admin' | 'hr' | 'manager' | 'employee'): GrantedPermissions =>
  Object.fromEntries(systemRoleGrants(role).map((g) => [g.code, g.scope]));

describe('audit catalog', () => {
  it('puts every action in exactly one area, as a dotted name', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    for (const action of AUDIT_ACTIONS) expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it('guards each area with a permission from the catalog', () => {
    const codes = new Set(PERMISSIONS.map((p) => p.code));
    for (const area of AUDIT_AREA_KEYS) expect(codes.has(AUDIT_AREAS[area].permission)).toBe(true);
  });

  it('finds the area of an action and nothing for an unknown one', () => {
    expect(auditAreaOf('compensation.set')).toBe('compensation');
    expect(auditAreaOf('checklist_template.deleted')).toBe('checklists');
    expect(auditAreaOf('compensation.amount_seen')).toBeNull();
    expect(auditAreaOf('')).toBeNull();
  });
});

describe('visibleAuditAreas', () => {
  it('gives Admin everything except what Admin does not administer', () => {
    const areas = visibleAuditAreas(grantsOf('admin'));
    expect(areas).toContain('workspace');
    expect(areas).toContain('users');
    expect(areas).toContain('roles');
    expect(areas).toContain('people');
  });

  it('gives HR the HR-related areas and never the workspace settings', () => {
    const areas = visibleAuditAreas(grantsOf('hr'));
    expect(areas).toEqual(expect.arrayContaining(['people', 'compensation', 'privacy', 'leave']));
    expect(areas).not.toContain('workspace');
  });

  it('gives managers and employees nothing', () => {
    expect(visibleAuditAreas(grantsOf('manager'))).toEqual([]);
    expect(visibleAuditAreas(grantsOf('employee'))).toEqual([]);
  });

  it('needs both the audit permission and the area permission at scope all', () => {
    expect(visibleAuditAreas({ 'compensation.view': 'all' })).toEqual([]);
    expect(visibleAuditAreas({ 'admin.audit_log.view': 'all' })).toEqual([]);
    expect(
      visibleAuditAreas({ 'admin.audit_log.view': 'all', 'compensation.view': 'all' }),
    ).toEqual(['compensation']);
    expect(
      visibleAuditAreas({ 'admin.audit_log.view': 'all', 'timesheet.approve': 'reports' }),
    ).toEqual([]);
    expect(
      visibleAuditAreas({ 'admin.audit_log.view': 'department', 'compensation.view': 'all' }),
    ).toEqual([]);
  });
});

describe('auditQuerySchema', () => {
  it('fills the defaults and accepts filters', () => {
    expect(auditQuerySchema.parse({})).toEqual({ page: 1, pageSize: 50 });
    expect(
      auditQuerySchema.parse({ area: 'leave', from: '2026-11-01', to: '2026-11-01', page: '2' }),
    ).toMatchObject({ area: 'leave', from: '2026-11-01', to: '2026-11-01', page: 2 });
  });

  it.each([
    [{ area: 'payroll' }],
    [{ from: '2026-13-01' }],
    [{ from: '2026-11-05', to: '2026-11-04' }],
    [{ entityId: 'not-a-uuid' }],
    [{ actorUserId: '123' }],
    [{ pageSize: '101' }],
    [{ page: '0' }],
  ])('refuses %j', (query) => {
    expect(auditQuerySchema.safeParse(query).success).toBe(false);
  });
});
