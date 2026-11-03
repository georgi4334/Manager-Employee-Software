import type { GrantedPermissions } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import { userWithRole } from '@/tests/server';
import { paletteTargets } from './entries';

const grants = (role: 'admin' | 'employee') => userWithRole(role).permissions as GrantedPermissions;

const ids = (granted: Parameters<typeof paletteTargets>[0]) =>
  paletteTargets(granted).map((t) => `${t.kind}:${t.id}`);

describe('paletteTargets', () => {
  it('offers only what everybody may use without permissions', () => {
    expect(ids({})).toEqual([
      'page:/',
      'page:/inbox',
      'action:myProfile',
      'action:notificationSettings',
    ]);
  });

  it('adds pages, their sections and actions by permission', () => {
    const targets = ids({ 'leave.request': 'own', 'leave.approve': 'reports' });
    expect(targets).toContain('page:/leave');
    expect(targets).toContain('section:/leave#my');
    expect(targets).toContain('section:/leave#approvals');
    expect(targets).not.toContain('section:/leave#settings');
    expect(targets).toContain('action:requestLeave');
    expect(targets).not.toContain('action:addEmployee');
  });

  it('lists no sections for a page with only one', () => {
    const targets = ids({ 'leave.request': 'own' });
    expect(targets).toContain('page:/leave');
    expect(targets.filter((t) => t.startsWith('section:/leave'))).toEqual([]);
  });

  it('links the first section to the page itself and the others by parameter', () => {
    const targets = paletteTargets({ 'leave.request': 'own', 'leave.approve': 'reports' });
    expect(targets.find((t) => t.id === '/leave#my')?.to).toBe('/leave');
    expect(targets.find((t) => t.id === '/leave#approvals')?.to).toBe('/leave?tab=approvals');
  });

  it('gives an administrator the admin actions, an employee not', () => {
    expect(ids(grants('admin'))).toContain('action:newRole');
    expect(ids(grants('admin'))).toContain('action:addEmployee');
    expect(ids(grants('employee'))).not.toContain('action:newRole');
    expect(ids(grants('employee'))).not.toContain('action:addEmployee');
  });
});
