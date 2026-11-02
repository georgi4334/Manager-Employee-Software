import { mergeGrants, systemRoleGrants, type GrantedPermissions } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import { GROUP_LABEL, groupNavItems, NAV_GROUPS, NAV_ITEMS } from './nav';
import { PAGE_SECTIONS, sectionHref, visibleSections, type SectionPage } from './sections';

const role = (r: 'admin' | 'hr' | 'manager' | 'employee') => mergeGrants([systemRoleGrants(r)]);

describe('visibleSections', () => {
  it('gives each role the sections its permissions allow, in order', () => {
    expect(visibleSections('/leave', role('employee'))).toEqual(['my']);
    expect(visibleSections('/leave', role('manager'))).toEqual(['my', 'approvals', 'team']);
    expect(visibleSections('/reviews', role('employee'))).toEqual(['mine']);
    expect(visibleSections('/reviews', role('manager'))).toEqual(['mine', 'team']);
    expect(visibleSections('/feedback', role('hr'))).toContain('reported');
    expect(visibleSections('/feedback', role('employee'))).not.toContain('reported');
  });

  it('shows nothing that needs a permission to somebody without any', () => {
    const none: GrantedPermissions = {};
    expect(visibleSections('/leave', none)).toEqual([]);
    expect(visibleSections('/time', none)).toEqual([]);
    // sections without a rule stay (the page itself is guarded by its route)
    expect(visibleSections('/organization', none)).toEqual(['chart', 'departments', 'teams']);
    expect(visibleSections('/projects', none)).toEqual(['projects']);
  });

  it('applies scopes, not only codes', () => {
    const own: GrantedPermissions = { 'leave.request': 'own', 'leave.view': 'own' };
    expect(visibleSections('/leave', own)).toEqual(['my']);
    expect(visibleSections('/leave', { ...own, 'leave.view': 'reports' })).toEqual(['my', 'team']);
    expect(visibleSections('/reviews', { 'review.view': 'all' })).toEqual(['mine', 'team', 'all']);
  });
});

describe('sectionHref', () => {
  it('links the first section to the page itself and the rest with their parameter', () => {
    expect(sectionHref('/leave', 'my', 'my')).toBe('/leave');
    expect(sectionHref('/leave', 'approvals', 'my')).toBe('/leave?tab=approvals');
    expect(sectionHref('/feedback', 'given', 'received')).toBe('/feedback?box=given');
  });

  it('only lists pages that are menu entries', () => {
    const paths = new Set(NAV_ITEMS.map((i) => i.path));
    for (const page of Object.keys(PAGE_SECTIONS) as SectionPage[])
      expect(paths.has(page)).toBe(true);
  });
});

describe('menu groups', () => {
  it('puts every entry in a known group and lists the groups in order', () => {
    for (const item of NAV_ITEMS) expect(NAV_GROUPS).toContain(item.group);
    const groups = groupNavItems(NAV_ITEMS).map((g) => g.group);
    expect(groups).toEqual([...NAV_GROUPS]);
    expect(Object.keys(GROUP_LABEL)).toEqual(NAV_GROUPS.filter((g) => g !== 'top'));
  });

  it('leaves out groups without a visible entry', () => {
    const employeeOnly = NAV_ITEMS.filter((i) => i.group !== 'admin' && i.group !== 'insights');
    expect(groupNavItems(employeeOnly).map((g) => g.group)).not.toContain('admin');
    expect(groupNavItems([])).toEqual([]);
  });
});
