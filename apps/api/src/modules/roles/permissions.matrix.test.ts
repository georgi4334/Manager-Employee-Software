import {
  PERMISSIONS,
  RELATIONS,
  SYSTEM_ROLES,
  mergeGrants,
  scopeCovers,
  systemRoleGrants,
  type PermissionDef,
  type PermissionScope,
  type Relation,
  type SystemRole,
} from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  AuthorizationService,
  type OrgRelations,
} from '../../common/auth/authorization.service.js';

/**
 * Generated from the catalog: every permission x every role x every kind of record owner.
 * Allowed and denied cases are both covered, so granting or revoking anything changes a test.
 */
const org: OrgRelations = {
  relationOf: async (_actor, owner) => owner as Relation,
  relationsToEmployees: async (_actor, ids) => new Map(ids.map((id) => [id, id as Relation])),
};
const authz = new AuthorizationService(org);

const actorFor = (role: SystemRole) => ({
  userId: 'actor',
  permissions: mergeGrants([systemRoleGrants(role)]),
});

describe.each(SYSTEM_ROLES)('permission matrix: %s', (role) => {
  const actor = actorFor(role);

  it.each(PERMISSIONS.map((p) => p.code))('%s', async (code) => {
    const permission = PERMISSIONS.find((p) => p.code === code) as PermissionDef;
    const scope: PermissionScope | undefined = (
      permission.grants as Record<string, PermissionScope | undefined>
    )[role];

    if (!scope) {
      // Denied: no record, no scope helps.
      expect(await authz.can(actor, code)).toBe(false);
      await expect(authz.assert(actor, code)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      for (const relation of RELATIONS)
        expect(await authz.can(actor, code, { ownerUserId: relation })).toBe(false);
      return;
    }

    // Allowed: exactly the relations the scope covers.
    expect(await authz.can(actor, code)).toBe(true);
    for (const relation of RELATIONS) {
      expect(
        await authz.can(actor, code, { ownerUserId: relation }),
        `${role} ${code} on ${relation}`,
      ).toBe(scopeCovers(scope, relation));
    }
  });
});

describe('a user without any role', () => {
  const actor = { userId: 'nobody', permissions: mergeGrants([]) };

  it.each(PERMISSIONS.map((p) => p.code))('is denied %s', async (code) => {
    expect(await authz.can(actor, code)).toBe(false);
  });
});

describe('a user with several roles', () => {
  it('gets the widest scope per permission, never less than any single role', () => {
    const merged = mergeGrants([systemRoleGrants('employee'), systemRoleGrants('manager')]);
    expect(merged['leave.view']).toBe('team');
    expect(merged['leave.approve']).toBe('reports');
    expect(merged['admin.user.invite']).toBeUndefined();
    for (const role of ['employee', 'manager'] as const) {
      for (const { code } of systemRoleGrants(role)) expect(merged[code]).toBeDefined();
    }
  });
});
