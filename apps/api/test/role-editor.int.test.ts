import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  MAX_CUSTOM_ROLES,
  apiErrorBodySchema,
  roleDetailSchema,
  roleListItemSchema,
  type Grant,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;
const UNKNOWN = '0192f5a0-0000-7000-8000-00000000000a';
const api = '/api/v1';
const g = (code: string, scope: Grant['scope']): Grant => ({ code, scope });
/** Allows every scope, and the administrator holds it at `all`. */
const SCHEDULE = 'leave.approve';
/** Allows `all` only; the delegate below does not hold it. */
const LACKED = 'employee.manage_schedule';
/** Admin has no read grant for received feedback (ADR 0021), so nobody can pass it on. */
const NOT_ADMINS = 'feedback.view_received';

describe.skipIf(!urls)('role editor over HTTP (real database)', () => {
  const env = testEnv({
    DATABASE_URL: urls?.app,
    SYSTEM_DATABASE_URL: urls?.system,
    TRUST_PROXY: 'true',
  });
  let app: NestExpressApplication;
  let system: SystemPrismaService;
  const { workspace, accept } = httpWorkspaceHelpers(() => app);

  let acme: Workspace;
  let globex: Workspace;
  let hr: Member;
  let dan: Member;
  let people = 0;

  async function onboard(ws: Workspace, role: 'employee' | 'hr' = 'employee'): Promise<Member> {
    const name = `p${++people}`;
    const email = `${name}@${ws === acme ? 'acme' : 'globex'}.eu`;
    const invited = await ws.admin.agent.post(`${api}/users/invitations`).send({ email });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    const who = await accept(email);
    if (role !== 'employee') {
      const set = await ws.admin.agent
        .put(`${api}/users/${who.id}/roles`)
        .send({ roleIds: [ws.roleIds[role]] });
      expect(set.status).toBe(200);
    }
    return who;
  }
  const create = (as: Member, body: object) => as.agent.post(`${api}/roles`).send(body);
  const make = async (as: Member, name: string, grants: Grant[], description?: string) => {
    const res = await create(as, { name, grants, ...(description ? { description } : {}) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return roleDetailSchema.parse(res.body);
  };
  const edit = (as: Member, id: string, body: object) =>
    as.agent.put(`${api}/roles/${id}`).send(body);
  const give = async (ws: Workspace, who: Member, ...roleIds: string[]) => {
    const res = await ws.admin.agent.put(`${api}/users/${who.id}/roles`).send({ roleIds });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  const customRoles = (ws: Workspace) =>
    system.role.deleteMany({
      where: { tenantId: ws.tenantId, isSystem: false, users: { none: {} } },
    });

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    hr = await onboard(acme, 'hr');
    dan = await onboard(acme);
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  describe('reading', () => {
    it('lists the system roles with their counts, for administrators and HR', async () => {
      for (const who of [acme.admin, hr]) {
        const res = await who.agent.get(`${api}/roles`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const roles = (res.body as unknown[]).map((r) => roleListItemSchema.parse(r));
        expect(
          roles
            .map((r) => r.key)
            .slice(0, 4)
            .sort(),
        ).toEqual(['admin', 'employee', 'hr', 'manager']);
        const employee = roles.find((r) => r.key === 'employee')!;
        expect(employee.userCount).toBeGreaterThanOrEqual(1);
        expect(employee.permissionCount).toBeGreaterThan(0);
      }
    });

    it('is refused to people without the permission', async () => {
      expect((await dan.agent.get(`${api}/roles`)).status).toBe(403);
      expect((await dan.agent.get(`${api}/roles/${UNKNOWN}`)).status).toBe(403);
    });

    it('shows one role with its grants; unknown, foreign and malformed ids are 404/400', async () => {
      const roles = (await acme.admin.agent.get(`${api}/roles`)).body as {
        id: string;
        key: string;
      }[];
      const adminRole = roles.find((r) => r.key === 'admin')!;
      const res = await hr.agent.get(`${api}/roles/${adminRole.id}`);
      const detail = roleDetailSchema.parse(res.body);
      expect(detail.isSystem).toBe(true);
      expect(detail.grants.length).toBeGreaterThan(10);
      expect((await hr.agent.get(`${api}/roles/${UNKNOWN}`)).status).toBe(404);
      expect((await globex.admin.agent.get(`${api}/roles/${adminRole.id}`)).status).toBe(404);
      expect((await hr.agent.get(`${api}/roles/nope`)).status).toBe(400);
    });
  });

  describe('creating', () => {
    it('makes a custom role that takes effect at once for whoever holds it', async () => {
      const role = await make(
        acme.admin,
        'Role viewer',
        [g('admin.role.view', 'all')],
        'Reads roles',
      );
      expect(role).toMatchObject({
        name: 'Role viewer',
        description: 'Reads roles',
        isSystem: false,
        key: null,
        userCount: 0,
        grants: [g('admin.role.view', 'all')],
      });
      expect((await dan.agent.get(`${api}/roles`)).status).toBe(403);
      await give(acme, dan, acme.roleIds.employee, role.id);
      expect((await dan.agent.get(`${api}/roles`)).status).toBe(200);
      // changing the role changes the person's rights on their next request
      expect((await edit(acme.admin, role.id, { name: 'Role viewer', grants: [] })).status).toBe(
        200,
      );
      expect((await dan.agent.get(`${api}/roles`)).status).toBe(403);
      await give(acme, dan, acme.roleIds.employee);
    });

    it('is for administrators only: HR may read roles but not create them', async () => {
      const res = await create(hr, { name: 'Sneaky', grants: [] });
      expect(res.status).toBe(403);
      expect(await system.role.count({ where: { name: 'Sneaky' } })).toBe(0);
    });

    it.each([
      ['no name', { name: ' ', grants: [] }],
      ['a long name', { name: 'x'.repeat(61), grants: [] }],
      ['a long description', { name: 'Ok', description: 'x'.repeat(201), grants: [] }],
      ['an unknown permission', { name: 'Ok', grants: [g('payroll.run', 'all')] }],
      [
        'a scope the permission does not allow',
        { name: 'Ok', grants: [g('admin.role.manage', 'own')] },
      ],
      ['an unknown scope', { name: 'Ok', grants: [{ code: SCHEDULE, scope: 'galaxy' }] }],
      ['a permission twice', { name: 'Ok', grants: [g(SCHEDULE, 'own'), g(SCHEDULE, 'all')] }],
      ['a flag for system roles', { name: 'Ok', grants: [], isSystem: true }],
      ['no grants field', { name: 'Ok' }],
    ])('refuses %s', async (_label, body) => {
      const res = await create(acme.admin, body);
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    });

    it('refuses a name that exists, without regard to case, also the names of system roles', async () => {
      await make(acme.admin, 'Contractor', []);
      for (const name of ['Contractor', 'contractor', 'CONTRACTOR', 'Admin', 'hr']) {
        const res = await create(acme.admin, { name, grants: [] });
        expect(res.status, name).toBe(409);
        expect(errorBody(res).params).toMatchObject({ field: 'name' });
      }
      // another workspace may use the name
      expect((await create(globex.admin, { name: 'Contractor', grants: [] })).status).toBe(201);
    });

    it('stops at the limit of custom roles', async () => {
      await customRoles(acme);
      const have = await system.role.count({ where: { tenantId: acme.tenantId, isSystem: false } });
      await system.role.createMany({
        data: Array.from({ length: MAX_CUSTOM_ROLES - have }, (_, i) => ({
          tenantId: acme.tenantId,
          name: `Filler ${i}`,
          isSystem: false,
        })),
      });
      const res = await create(acme.admin, { name: 'One too many', grants: [] });
      expect(res.status).toBe(409);
      expect(errorBody(res).params).toMatchObject({ field: 'limit' });
      await system.role.deleteMany({
        where: { tenantId: acme.tenantId, name: { startsWith: 'Filler' } },
      });
    });
  });

  describe('nobody grants what they do not hold', () => {
    it('refuses permissions that even the administrator does not hold', async () => {
      const res = await create(acme.admin, { name: 'Reader', grants: [g(NOT_ADMINS, 'all')] });
      expect(res.status).toBe(403);
      expect(errorBody(res).details?.[0]).toMatchObject({ code: 'cannot_grant' });
      expect(await system.role.count({ where: { name: 'Reader' } })).toBe(0);
    });

    describe('a delegate with limited rights', () => {
      let delegate: Member;
      beforeAll(async () => {
        const holder = await make(acme.admin, 'Role manager', [
          g('admin.role.manage', 'all'),
          g('admin.role.view', 'all'),
          g(SCHEDULE, 'team'),
        ]);
        delegate = await onboard(acme);
        await give(acme, delegate, acme.roleIds.employee, holder.id);
      });

      it('may grant what they hold at that scope or narrower', async () => {
        expect(
          (await create(delegate, { name: 'Narrow A', grants: [g(SCHEDULE, 'team')] })).status,
        ).toBe(201);
        expect(
          (await create(delegate, { name: 'Narrow B', grants: [g(SCHEDULE, 'own')] })).status,
        ).toBe(201);
        expect(
          (await create(delegate, { name: 'Narrow C', grants: [g('admin.role.view', 'all')] }))
            .status,
        ).toBe(201);
      });

      it('may not grant a wider scope, or a permission they lack', async () => {
        for (const grant of [g(SCHEDULE, 'all'), g(SCHEDULE, 'department'), g(LACKED, 'all')]) {
          const res = await create(delegate, {
            name: `Wide ${grant.code}${grant.scope}`,
            grants: [grant],
          });
          expect(res.status, JSON.stringify(grant)).toBe(403);
          expect(errorBody(res).details?.[0]?.code).toBe('cannot_grant');
        }
      });

      it('keeps grants they could not have added when they rename a role, but cannot widen or add', async () => {
        const wide = await make(acme.admin, 'Wide by admin', [
          g(SCHEDULE, 'all'),
          g(LACKED, 'all'),
        ]);
        const renamed = await edit(delegate, wide.id, {
          name: 'Renamed by delegate',
          grants: wide.grants,
        });
        expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
        // taking grants away is fine
        const narrower = await edit(delegate, wide.id, {
          name: 'Renamed by delegate',
          grants: [g(SCHEDULE, 'team')],
        });
        expect(narrower.status).toBe(200);
        // putting one back, or adding another, is not
        for (const grants of [[g(SCHEDULE, 'all')], [g(SCHEDULE, 'team'), g(LACKED, 'all')]]) {
          const res = await edit(delegate, wide.id, { name: 'Renamed by delegate', grants });
          expect(res.status, JSON.stringify(grants)).toBe(403);
        }
        const now = roleDetailSchema.parse(
          (await acme.admin.agent.get(`${api}/roles/${wide.id}`)).body,
        );
        expect(now.grants).toEqual([g(SCHEDULE, 'team')]);
      });
    });
  });

  describe('changing and deleting', () => {
    it('replaces name, description and grants of a custom role', async () => {
      await make(acme.admin, 'Taken', []);
      const role = await make(acme.admin, 'Draft', [g(SCHEDULE, 'own')]);
      const res = await edit(acme.admin, role.id, {
        name: 'Final',
        description: 'Done',
        grants: [g(SCHEDULE, 'all'), g('admin.role.view', 'all')],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(roleDetailSchema.parse(res.body)).toMatchObject({
        name: 'Final',
        description: 'Done',
        grants: [g('admin.role.view', 'all'), g(SCHEDULE, 'all')],
      });
      // keeping its own name is not a conflict; taking another role's is
      expect((await edit(acme.admin, role.id, { name: 'final', grants: [] })).status).toBe(200);
      expect((await edit(acme.admin, role.id, { name: 'taken', grants: [] })).status).toBe(409);
    });

    it('leaves system roles alone', async () => {
      const roles = (await acme.admin.agent.get(`${api}/roles`)).body as {
        id: string;
        key: string;
      }[];
      const hrRole = roles.find((r) => r.key === 'hr')!;
      const before = roleDetailSchema.parse(
        (await acme.admin.agent.get(`${api}/roles/${hrRole.id}`)).body,
      );
      const put = await edit(acme.admin, hrRole.id, { name: 'HR', grants: [] });
      expect(put.status).toBe(403);
      expect((await acme.admin.agent.delete(`${api}/roles/${hrRole.id}`)).status).toBe(403);
      const after = roleDetailSchema.parse(
        (await acme.admin.agent.get(`${api}/roles/${hrRole.id}`)).body,
      );
      expect(after).toEqual(before);
    });

    it('is 404 for unknown and foreign roles, 403 for people who may not manage', async () => {
      const mine = await make(acme.admin, 'Only here', []);
      expect((await edit(acme.admin, UNKNOWN, { name: 'X', grants: [] })).status).toBe(404);
      expect((await edit(globex.admin, mine.id, { name: 'X', grants: [] })).status).toBe(404);
      expect((await globex.admin.agent.delete(`${api}/roles/${mine.id}`)).status).toBe(404);
      expect((await edit(hr, mine.id, { name: 'X', grants: [] })).status).toBe(403);
      expect((await hr.agent.delete(`${api}/roles/${mine.id}`)).status).toBe(403);
      expect((await acme.admin.agent.delete(`${api}/roles/nope`)).status).toBe(400);
    });

    it('deletes a role nobody holds, and refuses one that is still assigned', async () => {
      const role = await make(acme.admin, 'Temporary', [g('admin.role.view', 'all')]);
      await give(acme, dan, acme.roleIds.employee, role.id);
      const refused = await acme.admin.agent.delete(`${api}/roles/${role.id}`);
      expect(refused.status).toBe(409);
      expect(errorBody(refused).params).toMatchObject({ field: 'in_use' });
      expect((await acme.admin.agent.get(`${api}/roles/${role.id}`)).status).toBe(200);
      await give(acme, dan, acme.roleIds.employee);
      expect((await acme.admin.agent.delete(`${api}/roles/${role.id}`)).status).toBe(204);
      expect((await acme.admin.agent.get(`${api}/roles/${role.id}`)).status).toBe(404);
      expect((await acme.admin.agent.delete(`${api}/roles/${role.id}`)).status).toBe(404);
    });
  });

  describe('the last administrator', () => {
    it('cannot lose their power by editing the custom role that gives it', async () => {
      const lone = await workspace('initech');
      const power = roleDetailSchema.parse(
        (
          await create(lone.admin, {
            name: 'Super',
            grants: [
              g('admin.role.assign', 'all'),
              g('admin.role.manage', 'all'),
              g('admin.role.view', 'all'),
            ],
          })
        ).body,
      );
      const email = 'boss@initech.eu';
      expect((await lone.admin.agent.post(`${api}/users/invitations`).send({ email })).status).toBe(
        201,
      );
      const boss = await accept(email);
      await give(lone, boss, lone.roleIds.employee, power.id);
      // the original administrator steps down: the custom role is now the only source of admin power
      const stepDown = await boss.agent
        .put(`${api}/users/${lone.admin.id}/roles`)
        .send({ roleIds: [lone.roleIds.employee] });
      expect(stepDown.status, JSON.stringify(stepDown.body)).toBe(200);

      const res = await edit(boss, power.id, {
        name: 'Super',
        grants: [g('admin.role.manage', 'all'), g('admin.role.view', 'all')],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(errorBody(res).code).toBe('LAST_ADMIN');
      const still = roleDetailSchema.parse((await boss.agent.get(`${api}/roles/${power.id}`)).body);
      expect(still.grants.map((x) => x.code)).toContain('admin.role.assign');
      // narrowing it is fine as long as the permission stays; so is changing the name
      expect((await edit(boss, power.id, { name: 'Boss', grants: still.grants })).status).toBe(200);
    });

    it('may drop admin power from a custom role while another administrator remains', async () => {
      const role = await make(acme.admin, 'Helper admin', [g('admin.role.assign', 'all')]);
      const res = await edit(acme.admin, role.id, { name: 'Helper admin', grants: [] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  });

  describe('audit', () => {
    it('records the role id and the permissions that changed, never the name or description', async () => {
      const secret = 'Zebra Secret Role';
      const role = await make(acme.admin, secret, [g(SCHEDULE, 'own')], 'Secret description text');
      await edit(acme.admin, role.id, {
        name: secret,
        description: 'Secret description text',
        grants: [g(SCHEDULE, 'all'), g('admin.role.view', 'all')],
      });
      await acme.admin.agent.delete(`${api}/roles/${role.id}`);
      const rows = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, entityId: role.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual(['role.created', 'role.updated', 'role.deleted']);
      expect(rows[1]!.after).toEqual({
        added: ['admin.role.view:all'],
        changed: [`${SCHEDULE}:all`],
        removed: [],
      });
      expect(JSON.stringify(rows)).not.toMatch(/Zebra|Secret/);
    });

    it('records nothing for refused changes', async () => {
      const before = await system.auditLog.count({
        where: { tenantId: acme.tenantId, action: { startsWith: 'role.' } },
      });
      await create(acme.admin, { name: 'Reader', grants: [g(NOT_ADMINS, 'all')] });
      await create(hr, { name: 'Nope', grants: [] });
      expect(
        await system.auditLog.count({
          where: { tenantId: acme.tenantId, action: { startsWith: 'role.' } },
        }),
      ).toBe(before);
    });
  });
});
