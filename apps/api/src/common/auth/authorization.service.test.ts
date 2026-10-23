import { RELATIONS, type PermissionScope, type Relation } from '@intime/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  AuthorizationService,
  SelfOnlyOrgRelations,
  type Actor,
  type OrgRelations,
} from './authorization.service.js';

const ME = '0192f5a0-0000-7000-8000-00000000000a';
const OTHER = '0192f5a0-0000-7000-8000-00000000000b';

/** Owner ids encode the relation, so tests can ask about any relation. */
const ownerFor = (relation: Relation) => `owner-${relation}`;
const fakeOrg: OrgRelations = {
  relationOf: async (_actor, owner) => owner.replace('owner-', '') as Relation,
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
    const lazy = new AuthorizationService({ relationOf });
    expect(await lazy.can(actorWith('all'), 'leave.view', { ownerUserId: OTHER })).toBe(true);
    expect(relationOf).not.toHaveBeenCalled();
  });

  it('fails closed when the relation provider cannot tell (an error is not an "allow")', async () => {
    const broken = new AuthorizationService({
      relationOf: async () => {
        throw new Error('org lookup failed');
      },
    });
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

describe('SelfOnlyOrgRelations (until the Organization module exists)', () => {
  const selfOnly = new AuthorizationService(new SelfOnlyOrgRelations());

  it('knows only self and other', async () => {
    const org = new SelfOnlyOrgRelations();
    expect(await org.relationOf(ME, ME)).toBe('self');
    expect(await org.relationOf(ME, OTHER)).toBe('other');
  });

  it.each(['own', 'reports', 'team', 'department'] as const)(
    'a "%s" grant reaches only the actor’s own records',
    async (scope) => {
      expect(await selfOnly.can(actorWith(scope), 'leave.view', { ownerUserId: ME })).toBe(true);
      expect(await selfOnly.can(actorWith(scope), 'leave.view', { ownerUserId: OTHER })).toBe(
        false,
      );
    },
  );

  it('an "all" grant still reaches everyone', async () => {
    expect(await selfOnly.can(actorWith('all'), 'leave.view', { ownerUserId: OTHER })).toBe(true);
  });
});
