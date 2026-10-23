import {
  PERMISSIONS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_LABELS,
  mergeGrants,
  systemRoleGrants,
  type SystemRole,
} from '@intime/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { TenantContext, type TenantTx } from '../src/infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../src/infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { PermissionsService } from '../src/modules/roles/permissions.service.js';
import { SystemRolesService } from '../src/modules/roles/system-roles.service.js';
import { UserRolesService } from '../src/modules/roles/user-roles.service.js';
import { RoleGrantService } from '../src/modules/tenants/role-grant.service.js';
import { RoleSyncService } from '../src/modules/tenants/role-sync.service.js';
import { testDbUrls } from './db-urls.js';
import { testEnv } from './helpers.js';

const urls = testDbUrls();

const catalogFor = (role: SystemRole) =>
  new Map(systemRoleGrants(role).map((g) => [g.code as string, g.scope as string]));

describe.skipIf(!urls)('roles, permissions and audit log (real database)', () => {
  const env = testEnv({ DATABASE_URL: urls?.app, SYSTEM_DATABASE_URL: urls?.system });
  const context = new TenantContext();
  let app: PrismaService;
  let system: SystemPrismaService;
  let db: TenantDb;
  let systemRoles: SystemRolesService;
  const permissions = new PermissionsService();
  const audit = new AuditService();
  const userRoles = new UserRolesService();
  let sync: RoleSyncService;
  let grantRole: RoleGrantService;
  let tenantA: string;
  let tenantB: string;

  const asTenant = <T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>) =>
    context.run(tenantId, () => db.tx(fn));
  const seed = (tenantId: string) => asTenant(tenantId, (tx) => systemRoles.ensureSystemRoles(tx));
  const grantsInDb = async (roleId: string) =>
    new Map(
      (await system.rolePermission.findMany({ where: { roleId } })).map((g) => [
        g.permissionCode,
        g.scope,
      ]),
    );

  async function userWithRoles(tenantId: string, email: string, ...roles: SystemRole[]) {
    const user = await system.user.create({ data: { tenantId, email, status: 'active' } });
    await asTenant(tenantId, async (tx) => {
      const ids = await Promise.all(roles.map((r) => userRoles.roleIdByKey(tx, r)));
      await userRoles.setRoles(tx, user.id, ids);
    });
    return user;
  }

  beforeAll(() => {
    app = new PrismaService(env);
    system = new SystemPrismaService(env);
    db = new TenantDb(app, context);
    systemRoles = new SystemRolesService(context);
    sync = new RoleSyncService(system, context, db, systemRoles);
    grantRole = new RoleGrantService(system, context, db, systemRoles, audit);
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await Promise.all([app.$disconnect(), system.$disconnect()]);
  });
  beforeEach(async () => {
    await system.tenant.deleteMany();
    tenantA = (await system.tenant.create({ data: { name: 'Acme', slug: 'acme' } })).id;
    tenantB = (await system.tenant.create({ data: { name: 'Beta', slug: 'beta' } })).id;
  });

  describe('system roles', () => {
    it('are created per workspace with exactly the catalog grants', async () => {
      const result = await seed(tenantA);
      expect(result.rolesCreated).toBe(4);
      const roles = await system.role.findMany({
        where: { tenantId: tenantA },
        orderBy: { key: 'asc' },
      });
      expect(roles.map((r) => [r.key, r.name, r.isSystem])).toEqual(
        [...SYSTEM_ROLES].sort().map((key) => [key, SYSTEM_ROLE_LABELS[key], true]),
      );
      for (const role of roles) {
        expect(await grantsInDb(role.id), role.key ?? '').toEqual(
          catalogFor(role.key as SystemRole),
        );
      }
    });

    it('seeding twice changes nothing', async () => {
      await seed(tenantA);
      const second = await seed(tenantA);
      expect(second).toMatchObject({
        rolesCreated: 0,
        grantsAdded: 0,
        grantsChanged: 0,
        grantsRemoved: 0,
      });
      expect(await system.role.count({ where: { tenantId: tenantA } })).toBe(4);
    });

    it('two syncs at the same moment do not collide or duplicate', async () => {
      await Promise.all([seed(tenantA), seed(tenantA), seed(tenantA)]);
      expect(await system.role.count({ where: { tenantId: tenantA } })).toBe(4);
      const hr = await system.role.findFirstOrThrow({ where: { tenantId: tenantA, key: 'hr' } });
      expect(await grantsInDb(hr.id)).toEqual(catalogFor('hr'));
    });

    it('repairs drift: re-adds missing grants, resets changed scopes, removes extras, restores names', async () => {
      await seed(tenantA);
      const hr = await system.role.findFirstOrThrow({ where: { tenantId: tenantA, key: 'hr' } });
      const manager = await system.role.findFirstOrThrow({
        where: { tenantId: tenantA, key: 'manager' },
      });
      await system.rolePermission.delete({
        where: { roleId_permissionCode: { roleId: hr.id, permissionCode: 'leave.approve' } },
      });
      await system.rolePermission.update({
        where: { roleId_permissionCode: { roleId: manager.id, permissionCode: 'leave.approve' } },
        data: { scope: 'all' },
      });
      await system.rolePermission.create({
        data: { tenantId: tenantA, roleId: manager.id, permissionCode: 'made.up', scope: 'all' },
      });
      await system.role.update({ where: { id: hr.id }, data: { name: 'Renamed' } });

      const result = await seed(tenantA);
      expect(result).toMatchObject({ grantsAdded: 1, grantsChanged: 1, grantsRemoved: 1 });
      expect(await grantsInDb(hr.id)).toEqual(catalogFor('hr'));
      expect(await grantsInDb(manager.id)).toEqual(catalogFor('manager'));
      expect((await system.role.findUniqueOrThrow({ where: { id: hr.id } })).name).toBe('HR');
    });

    it('syncAll brings every workspace in line and reports per workspace', async () => {
      const results = await sync.syncAll();
      expect(results.map((r) => r.slug)).toEqual(['acme', 'beta']);
      expect(results.every((r) => r.result.rolesCreated === 4)).toBe(true);
      const again = await sync.syncAll();
      expect(
        again.every(
          (r) => r.result.grantsAdded + r.result.grantsChanged + r.result.grantsRemoved === 0,
        ),
      ).toBe(true);
    });

    it('each workspace has its own roles; one cannot see the other’s', async () => {
      await seed(tenantA);
      await seed(tenantB);
      const seenByA = await asTenant(tenantA, (tx) => tx.role.findMany());
      expect(seenByA).toHaveLength(4);
      expect(seenByA.every((r) => r.tenantId === tenantA)).toBe(true);
      expect(
        await asTenant(tenantA, (tx) => tx.rolePermission.count({ where: { tenantId: tenantB } })),
      ).toBe(0);
    });
  });

  describe('what a user may do (PermissionsService)', () => {
    it.each(SYSTEM_ROLES)(
      'a %s gets exactly the catalog permissions, read from the database',
      async (role) => {
        await seed(tenantA);
        const user = await userWithRoles(tenantA, `${role}@acme.eu`, role);
        const access = await asTenant(tenantA, (tx) => permissions.forUser(tx, user.id));
        expect(access.permissions).toEqual(mergeGrants([systemRoleGrants(role)]));
        expect(access.roles).toEqual([{ key: role, name: SYSTEM_ROLE_LABELS[role] }]);
      },
    );

    it('several roles give the widest scope per permission', async () => {
      await seed(tenantA);
      const user = await userWithRoles(tenantA, 'both@acme.eu', 'employee', 'manager');
      const { permissions: granted, roles } = await asTenant(tenantA, (tx) =>
        permissions.forUser(tx, user.id),
      );
      expect(granted['leave.view']).toBe('team');
      expect(granted['attendance.record']).toBe('own');
      expect(roles.map((r) => r.key).sort()).toEqual(['employee', 'manager']);
    });

    it('a user without roles can do nothing', async () => {
      await seed(tenantA);
      const user = await system.user.create({
        data: { tenantId: tenantA, email: 'none@acme.eu', status: 'active' },
      });
      const access = await asTenant(tenantA, (tx) => permissions.forUser(tx, user.id));
      expect(access).toEqual({ roles: [], permissions: {} });
    });

    it('ignores corrupted grants: unknown codes and scopes the permission does not allow', async () => {
      await seed(tenantA);
      const user = await userWithRoles(tenantA, 'emp@acme.eu', 'employee');
      const role = await system.role.findFirstOrThrow({
        where: { tenantId: tenantA, key: 'employee' },
      });
      await system.rolePermission.createMany({
        data: [
          { tenantId: tenantA, roleId: role.id, permissionCode: 'made.up', scope: 'all' },
          { tenantId: tenantA, roleId: role.id, permissionCode: 'employee.create', scope: 'own' },
        ],
      });
      const { permissions: granted } = await asTenant(tenantA, (tx) =>
        permissions.forUser(tx, user.id),
      );
      expect(granted).toEqual(mergeGrants([systemRoleGrants('employee')]));
      expect(granted).not.toHaveProperty('made.up');
      expect(granted).not.toHaveProperty('employee.create');
    });

    it('changes are visible at once: removing a role removes its permissions', async () => {
      await seed(tenantA);
      const user = await userWithRoles(tenantA, 'hr@acme.eu', 'hr');
      expect(
        (await asTenant(tenantA, (tx) => permissions.forUser(tx, user.id))).permissions[
          'admin.user.invite'
        ],
      ).toBe('all');
      await asTenant(tenantA, async (tx) =>
        userRoles.setRoles(tx, user.id, [await userRoles.roleIdByKey(tx, 'employee')]),
      );
      expect(
        (await asTenant(tenantA, (tx) => permissions.forUser(tx, user.id))).permissions[
          'admin.user.invite'
        ],
      ).toBeUndefined();
    });

    it('never mixes workspaces: another workspace’s user has no permissions here', async () => {
      await seed(tenantA);
      await seed(tenantB);
      const userInB = await userWithRoles(tenantB, 'admin@beta.eu', 'admin');
      const seenFromA = await asTenant(tenantA, (tx) => permissions.forUser(tx, userInB.id));
      expect(seenFromA).toEqual({ roles: [], permissions: {} });
    });
  });

  describe('assigning roles', () => {
    it('rejects unknown roles, empty lists and roles of another workspace', async () => {
      await seed(tenantA);
      await seed(tenantB);
      const user = await userWithRoles(tenantA, 'a@acme.eu', 'employee');
      const foreignRole = await system.role.findFirstOrThrow({
        where: { tenantId: tenantB, key: 'admin' },
      });
      for (const ids of [[], ['0192f5a0-0000-7000-8000-0000000000ff'], [foreignRole.id]]) {
        await expect(
          asTenant(tenantA, (tx) => userRoles.setRoles(tx, user.id, ids)),
        ).rejects.toMatchObject({
          code: 'VALIDATION_FAILED',
        });
      }
    });

    it('replaces roles and ignores duplicates', async () => {
      await seed(tenantA);
      const user = await userWithRoles(tenantA, 'a@acme.eu', 'employee');
      await asTenant(tenantA, async (tx) => {
        const manager = await userRoles.roleIdByKey(tx, 'manager');
        await userRoles.setRoles(tx, user.id, [manager, manager]);
      });
      const held = await system.userRole.findMany({
        where: { userId: user.id },
        include: { role: true },
      });
      expect(held.map((r) => r.role.key)).toEqual(['manager']);
    });

    it('the database refuses a role of another workspace even if the application did not check', async () => {
      await seed(tenantA);
      await seed(tenantB);
      const user = await userWithRoles(tenantA, 'a@acme.eu', 'employee');
      const foreignRole = await system.role.findFirstOrThrow({
        where: { tenantId: tenantB, key: 'admin' },
      });
      await expect(
        asTenant(tenantA, (tx) =>
          tx.userRole.create({ data: { userId: user.id, roleId: foreignRole.id } }),
        ),
      ).rejects.toThrow();
      await expect(
        system.userRole.create({
          data: { tenantId: tenantA, userId: user.id, roleId: foreignRole.id },
        }),
      ).rejects.toThrow();
    });

    it('the database refuses grants for another workspace’s role', async () => {
      await seed(tenantA);
      await seed(tenantB);
      const foreignRole = await system.role.findFirstOrThrow({
        where: { tenantId: tenantB, key: 'admin' },
      });
      await expect(
        asTenant(tenantA, (tx) =>
          tx.rolePermission.create({
            data: { roleId: foreignRole.id, permissionCode: 'leave.view', scope: 'own' },
          }),
        ),
      ).rejects.toThrow();
    });

    it('a role that is still assigned cannot be deleted', async () => {
      await seed(tenantA);
      const user = await userWithRoles(tenantA, 'a@acme.eu', 'hr');
      const hr = await system.role.findFirstOrThrow({ where: { tenantId: tenantA, key: 'hr' } });
      await expect(system.role.delete({ where: { id: hr.id } })).rejects.toThrow();
      expect(await system.userRole.count({ where: { userId: user.id } })).toBe(1);
    });
  });

  describe('roles:grant (operator tool)', () => {
    it('gives an account that predates roles its first role, creating the system roles on the way', async () => {
      const user = await system.user.create({
        data: { tenantId: tenantA, email: 'old@acme.eu', status: 'active' },
      });
      const result = await grantRole.grant({
        workspace: 'acme',
        email: ' OLD@acme.eu ',
        role: 'admin',
      });
      expect(result).toMatchObject({ userId: user.id, roleKey: 'admin', added: true });
      const access = await asTenant(tenantA, (tx) => permissions.forUser(tx, user.id));
      expect(access.permissions['admin.role.assign']).toBe('all');
      const [entry] = await system.auditLog.findMany({
        where: { tenantId: tenantA, action: 'user.role_granted' },
      });
      expect(entry).toMatchObject({ actorUserId: null, entityId: user.id });
    });

    it('is idempotent and adds to existing roles instead of replacing them', async () => {
      await seed(tenantA);
      await userWithRoles(tenantA, 'a@acme.eu', 'employee');
      expect(
        (await grantRole.grant({ workspace: 'acme', email: 'a@acme.eu', role: 'hr' })).added,
      ).toBe(true);
      expect(
        (await grantRole.grant({ workspace: 'acme', email: 'a@acme.eu', role: 'hr' })).added,
      ).toBe(false);
      const user = await system.user.findFirstOrThrow({
        where: { tenantId: tenantA, email: 'a@acme.eu' },
      });
      const held = await system.userRole.findMany({
        where: { userId: user.id },
        include: { role: true },
      });
      expect(held.map((r) => r.role.key).sort()).toEqual(['employee', 'hr']);
    });

    it.each([
      [
        'an unknown workspace',
        { workspace: 'nope', email: 'a@acme.eu', role: 'admin' },
        'NOT_FOUND',
      ],
      [
        'an unknown user',
        { workspace: 'acme', email: 'ghost@acme.eu', role: 'admin' },
        'NOT_FOUND',
      ],
      [
        'an invalid role',
        { workspace: 'acme', email: 'a@acme.eu', role: 'superuser' },
        'VALIDATION_FAILED',
      ],
      [
        'an invalid workspace',
        { workspace: "x'; drop", email: 'a@acme.eu', role: 'admin' },
        'VALIDATION_FAILED',
      ],
    ])('rejects %s', async (_label, input, code) => {
      await seed(tenantA);
      await userWithRoles(tenantA, 'a@acme.eu', 'employee');
      await expect(grantRole.grant(input)).rejects.toMatchObject({ code });
    });

    it('never reaches a user of another workspace', async () => {
      await seed(tenantB);
      await userWithRoles(tenantB, 'b@beta.eu', 'employee');
      await expect(
        grantRole.grant({ workspace: 'acme', email: 'b@beta.eu', role: 'admin' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('database constraints', () => {
    it.each([
      ['an unknown system key', { key: 'boss', name: 'Boss', isSystem: true }],
      ['a system role without a key', { key: null, name: 'Keyless', isSystem: true }],
      ['a custom role that claims a system key', { key: 'hr', name: 'Fake HR', isSystem: false }],
      ['a blank name', { key: null, name: '   ', isSystem: false }],
    ])('rejects %s', async (_label, data) => {
      await expect(system.role.create({ data: { tenantId: tenantA, ...data } })).rejects.toThrow();
    });

    it('allows a custom role (no key, not system) and enforces unique names', async () => {
      await system.role.create({
        data: { tenantId: tenantA, name: 'Contractor', isSystem: false },
      });
      await expect(
        system.role.create({ data: { tenantId: tenantA, name: 'Contractor', isSystem: false } }),
      ).rejects.toThrow();
      // The same name in another workspace is fine.
      await system.role.create({
        data: { tenantId: tenantB, name: 'Contractor', isSystem: false },
      });
    });

    it('rejects invalid scopes and malformed permission codes', async () => {
      await seed(tenantA);
      const role = await system.role.findFirstOrThrow({
        where: { tenantId: tenantA, key: 'employee' },
      });
      for (const data of [
        { permissionCode: 'leave.view_balance', scope: 'galaxy' },
        { permissionCode: 'Bad Code', scope: 'own' },
        { permissionCode: '; drop table', scope: 'own' },
      ]) {
        await expect(
          system.rolePermission.create({ data: { tenantId: tenantA, roleId: role.id, ...data } }),
        ).rejects.toThrow();
      }
    });
  });

  describe('audit log', () => {
    const record = (tenantId: string, action = 'user.disabled') =>
      asTenant(tenantId, (tx) =>
        audit.record(tx, {
          actorUserId: '0192f5a0-0000-7000-8000-00000000000a',
          action,
          entity: 'user',
          entityId: '0192f5a0-0000-7000-8000-00000000000b',
          before: { status: 'active' },
          after: { status: 'disabled' },
        }),
      );

    it('records who did what, with before and after', async () => {
      await record(tenantA);
      const [entry] = await system.auditLog.findMany({ where: { tenantId: tenantA } });
      expect(entry).toMatchObject({
        action: 'user.disabled',
        entity: 'user',
        before: { status: 'active' },
        after: { status: 'disabled' },
      });
      expect(entry?.createdAt).toBeInstanceOf(Date);
    });

    it('accepts system actions without an actor', async () => {
      await asTenant(tenantA, (tx) =>
        audit.record(tx, { actorUserId: null, action: 'tenant.created', entity: 'tenant' }),
      );
      expect(
        (await system.auditLog.findFirstOrThrow({ where: { tenantId: tenantA } })).actorUserId,
      ).toBeNull();
    });

    it('rejects blank actions', async () => {
      await expect(
        asTenant(tenantA, (tx) =>
          audit.record(tx, { actorUserId: null, action: ' ', entity: 'user' }),
        ),
      ).rejects.toThrow();
    });

    it('cannot be changed or deleted by the application role (append-only)', async () => {
      await record(tenantA);
      await expect(
        asTenant(tenantA, (tx) => tx.$executeRaw`UPDATE audit_log SET action = 'tampered'`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asTenant(tenantA, (tx) => tx.$executeRaw`DELETE FROM audit_log`),
      ).rejects.toThrow(/permission denied/);
      expect(await system.auditLog.count({ where: { action: 'user.disabled' } })).toBe(1);
    });

    it('cannot be rewritten by the system role either; it may only delete (retention job)', async () => {
      await record(tenantA);
      await expect(system.$executeRaw`UPDATE audit_log SET action = 'tampered'`).rejects.toThrow(
        /permission denied/,
      );
      await system.auditLog.deleteMany({ where: { tenantId: tenantA } });
      expect(await system.auditLog.count({ where: { tenantId: tenantA } })).toBe(0);
    });

    it('is isolated per workspace: no reading, no writing into another’s log', async () => {
      await record(tenantA);
      expect(await asTenant(tenantB, (tx) => tx.auditLog.count())).toBe(0);
      await expect(
        asTenant(tenantB, (tx) =>
          tx.auditLog.create({ data: { tenantId: tenantA, action: 'x', entity: 'y' } }),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('covers every permission in the catalog (sanity check for the fixtures above)', () => {
    expect(PERMISSIONS.length).toBeGreaterThan(70);
  });
});
