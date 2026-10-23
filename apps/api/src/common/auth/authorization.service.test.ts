import { RELATIONS, type PermissionScope, type Relation } from '@intime/contracts';
import { describe, expect, it, vi } from 'vitest';
import { AuthorizationService, type Actor, type OrgRelations } from './authorization.service.js';

const ME = '0192f5a0-0000-7000-8000-00000000000a';
const OTHER = '0192f5a0-0000-7000-8000-00000000000b';

/** Owner ids encode the relation, so tests can ask about any relation. */
const ownerFor = (relation: Relation) => `owner-${relation}`;
const fakeOrg: OrgRelations = {
  relationOf: async (_actor, owner) => owner.replace('owner-', '') as Relation,
  relationsToEmployees: async (_actor, ids) =>
    new Map(ids.map((id) => [id, id.replace('owner-', '') as Relation])),
};
const service = new AuthorizationService(fakeOrg);
const actorWith = (scope?: PermissionScope): Actor => ({
  userId: ME,
  permissions: scope ? { 'leave.view': scope } : {},
});

describe('AuthorizationService.can', () => {
  it('denies a permission the actor does not hold, whatever the record', async () => {
    expect(await service.can(actorWith(), 'leave.view')).toBe(false);
    expect(await service.can(actorWith(), 'leave.view', { ownerUserId: ME })).toBe(false);
  });

  it('without a resource it only asks whether the actor holds the permission', async () => {
    for (const scope of ['own', 'reports', 'team', 'department', 'all'] as const) {
      expect(await service.can(actorWith(scope), 'leave.view')).toBe(true);
    }
    expect(await service.can(actorWith('own'), 'leave.view', {})).toBe(true);
  });

  describe.each([
    ['own', ['self']],
    ['reports', ['self', 'direct_report']],
    ['team', ['self', 'direct_report', 'subordinate']],
    ['department', ['self', 'direct_report', 'subordinate', 'same_department']],
    ['all', [...RELATIONS]],
  ] as const)('scope %s', (scope, covered) => {
    it.each(RELATIONS)('record owned by someone who is "%s" to the actor', async (relation) => {
      const allowed = await service.can(actorWith(scope), 'leave.view', {
        ownerUserId: ownerFor(relation),
      });
      expect(allowed).toBe((covered as readonly string[]).includes(relation));
    });
  });

  it('scope "all" does not even look up relations (no needless queries)', async () => {
    const relationOf = vi.fn(async () => 'other' as const);
    const lazy = new AuthorizationService({ relationOf, relationsToEmployees: vi.fn() });
    expect(await lazy.can(actorWith('all'), 'leave.view', { ownerUserId: OTHER })).toBe(true);
    expect(relationOf).not.toHaveBeenCalled();
  });

  it('fails closed when the relation provider cannot tell (an error is not an "allow")', async () => {
    const fail = async () => {
      throw new Error('org lookup failed');
    };
    const broken = new AuthorizationService({ relationOf: fail, relationsToEmployees: fail });
    await expect(
      broken.can(actorWith('team'), 'leave.view', { ownerUserId: OTHER }),
    ).rejects.toThrow('org lookup failed');
  });
});

describe('AuthorizationService.assert', () => {
  it('resolves when allowed', async () => {
    await expect(
      service.assert(actorWith('reports'), 'leave.view', {
        ownerUserId: ownerFor('direct_report'),
      }),
    ).resolves.toBeUndefined();
  });

  it('throws FORBIDDEN when the permission is missing', async () => {
    await expect(service.assert(actorWith(), 'leave.view')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('throws FORBIDDEN when the scope does not reach the record', async () => {
    await expect(
      service.assert(actorWith('reports'), 'leave.view', { ownerUserId: ownerFor('subordinate') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('employee-owned records', () => {
  it.each(RELATIONS)('scope "team" and an employee who is "%s" to the actor', async (relation) => {
    const allowed = await service.can(actorWith('team'), 'leave.view', {
      ownerEmployeeId: ownerFor(relation),
    });
    expect(allowed).toBe(['self', 'direct_report', 'subordinate'].includes(relation));
  });

  it('prefers the employee over the user when both are given', async () => {
    const allowed = await service.can(actorWith('own'), 'leave.view', {
      ownerUserId: ownerFor('self'),
      ownerEmployeeId: ownerFor('other'),
    });
    expect(allowed).toBe(false);
  });

  it('treats an employee the provider does not know as "other" (fail closed)', async () => {
    const silent = new AuthorizationService({
      relationOf: async () => 'other',
      relationsToEmployees: async () => new Map(),
    });
    expect(await silent.can(actorWith('department'), 'leave.view', { ownerEmployeeId: 'x' })).toBe(
      false,
    );
    expect(await silent.can(actorWith('all'), 'leave.view', { ownerEmployeeId: 'x' })).toBe(true);
  });

  it('allowedEmployees filters a list with one lookup and nothing for a missing permission', async () => {
    const relationsToEmployees = vi.fn(fakeOrg.relationsToEmployees);
    const batch = new AuthorizationService({
      relationOf: fakeOrg.relationOf,
      relationsToEmployees,
    });
    const ids = ['owner-self', 'owner-direct_report', 'owner-subordinate', 'owner-other'];
    expect([...(await batch.allowedEmployees(actorWith('reports'), 'leave.view', ids))]).toEqual([
      'owner-self',
      'owner-direct_report',
    ]);
    expect(relationsToEmployees).toHaveBeenCalledTimes(1);
    expect((await batch.allowedEmployees(actorWith(), 'leave.view', ids)).size).toBe(0);
    expect((await batch.allowedEmployees(actorWith('all'), 'leave.view', ids)).size).toBe(4);
    expect(relationsToEmployees).toHaveBeenCalledTimes(1);
  });
});
