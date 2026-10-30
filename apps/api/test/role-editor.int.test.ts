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

    it('is for administrators and HR (ADR 0036); other people may not create roles', async () => {
      const made = await make(hr, 'Made by HR', [g('admin.role.view', 'all')]);
      expect(made.isSystem).toBe(false);
      expect((await acme.admin.agent.delete(`${api}/roles/${made.id}`)).status).toBe(204);
      const res = await create(dan, { name: 'Sneaky', grants: [] });
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
      expect((await edit(dan, mine.id, { name: 'X', grants: [] })).status).toBe(403);
      expect((await dan.agent.delete(`${api}/roles/${mine.id}`)).status).toBe(403);
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

  describe('the role tree (ADR 0036)', () => {
    const move = (as: Member, id: string, parentId: string | null) =>
      as.agent.put(`${api}/roles/${id}/parent`).send({ parentId });
    const listed = async (as: Member) =>
      ((await as.agent.get(`${api}/roles`)).body as unknown[]).map((r) =>
        roleListItemSchema.parse(r),
      );

    it('starts with Admin > HR > Manager > Employee and lists the modules of each role', async () => {
      const fresh = await workspace('hooli');
      const roles = await listed(fresh.admin);
      const byKey = (key: string) => roles.find((r) => r.key === key)!;
      expect(byKey('admin').parentId).toBeNull();
      expect(byKey('hr').parentId).toBe(byKey('admin').id);
      expect(byKey('manager').parentId).toBe(byKey('hr').id);
      expect(byKey('employee').parentId).toBe(byKey('manager').id);
      expect(byKey('admin').modules).toContain('admin');
      expect(byKey('employee').modules).not.toContain('admin');
    });

    it('places a new role and moves it; the move never changes any grant', async () => {
      const lead = await make(acme.admin, 'Team lead', [g(SCHEDULE, 'team')]);
      expect(lead.parentId).toBeNull();
      const under = await create(hr, { name: 'Junior lead', grants: [], parentId: lead.id });
      expect(under.status, JSON.stringify(under.body)).toBe(201);
      expect(roleDetailSchema.parse(under.body).parentId).toBe(lead.id);

      const moved = await move(hr, lead.id, acme.roleIds.manager);
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      const after = roleDetailSchema.parse(moved.body);
      expect(after.parentId).toBe(acme.roleIds.manager);
      expect(after.grants).toEqual(lead.grants);
      // back to a root
      expect(roleDetailSchema.parse((await move(acme.admin, lead.id, null)).body).parentId).toBe(
        null,
      );
      // the editor can place it too, and leaves it alone when parentId is missing
      const edited = await edit(acme.admin, lead.id, {
        name: 'Team lead',
        grants: lead.grants,
        parentId: acme.roleIds.hr,
      });
      expect(roleDetailSchema.parse(edited.body).parentId).toBe(acme.roleIds.hr);
      const kept = await edit(acme.admin, lead.id, { name: 'Team lead', grants: lead.grants });
      expect(roleDetailSchema.parse(kept.body).parentId).toBe(acme.roleIds.hr);
    });

    it('moves system roles in the tree but keeps their grants read-only', async () => {
      const before = roleDetailSchema.parse(
        (await acme.admin.agent.get(`${api}/roles/${acme.roleIds.employee}`)).body,
      );
      const res = await move(hr, acme.roleIds.employee, acme.roleIds.hr);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const after = roleDetailSchema.parse(res.body);
      expect(after.parentId).toBe(acme.roleIds.hr);
      expect(after.grants).toEqual(before.grants);
      expect((await move(hr, acme.roleIds.employee, acme.roleIds.manager)).status).toBe(200);
    });

    it('refuses cycles: under itself or under one of its sub-roles', async () => {
      const top = await make(acme.admin, 'Cycle top', []);
      const mid = roleDetailSchema.parse(
        (await create(acme.admin, { name: 'Cycle mid', grants: [], parentId: top.id })).body,
      );
      const low = roleDetailSchema.parse(
        (await create(acme.admin, { name: 'Cycle low', grants: [], parentId: mid.id })).body,
      );
      for (const parentId of [top.id, mid.id, low.id]) {
        const res = await move(acme.admin, top.id, parentId);
        expect(res.status, parentId).toBe(400);
        expect(errorBody(res).details?.[0]).toMatchObject({ path: 'parentId', code: 'role_cycle' });
      }
      const viaEdit = await edit(acme.admin, mid.id, {
        name: 'Cycle mid',
        grants: [],
        parentId: low.id,
      });
      expect(viaEdit.status).toBe(400);
      // the editor's whole change is rolled back
      expect(
        roleDetailSchema.parse((await acme.admin.agent.get(`${api}/roles/${mid.id}`)).body),
      ).toMatchObject({
        name: 'Cycle mid',
        parentId: top.id,
      });
    });

    it('the database refuses a cycle too', async () => {
      const a = await make(acme.admin, 'Db a', []);
      const b = roleDetailSchema.parse(
        (await create(acme.admin, { name: 'Db b', grants: [], parentId: a.id })).body,
      );
      await expect(
        system.role.update({ where: { id: a.id }, data: { parentId: b.id } }),
      ).rejects.toThrow();
      await expect(
        system.role.update({ where: { id: a.id }, data: { parentId: a.id } }),
      ).rejects.toThrow();
    });

    it('refuses unknown, foreign and malformed parents', async () => {
      const role = await make(acme.admin, 'Lonely', []);
      const foreign = await make(globex.admin, 'Foreign parent', []);
      for (const parentId of [UNKNOWN, foreign.id]) {
        const res = await move(acme.admin, role.id, parentId);
        expect(res.status).toBe(400);
        expect(errorBody(res).details?.[0]).toMatchObject({ code: 'unknown_role' });
        const made = await create(acme.admin, { name: `Child ${parentId}`, grants: [], parentId });
        expect(made.status).toBe(400);
      }
      expect((await move(acme.admin, role.id, 'nope' as never)).status).toBe(400);
      expect((await acme.admin.agent.put(`${api}/roles/${role.id}/parent`).send({})).status).toBe(
        400,
      );
      expect((await move(acme.admin, UNKNOWN, null)).status).toBe(404);
      expect((await move(globex.admin, role.id, null)).status).toBe(404);
      expect((await move(dan, role.id, null)).status).toBe(403);
    });

    it('moves sub-roles up when a role is deleted', async () => {
      const parent = await make(acme.admin, 'Going away', []);
      await move(acme.admin, parent.id, acme.roleIds.manager);
      const child = roleDetailSchema.parse(
        (await create(acme.admin, { name: 'Staying', grants: [], parentId: parent.id })).body,
      );
      expect((await acme.admin.agent.delete(`${api}/roles/${parent.id}`)).status).toBe(204);
      const now = roleDetailSchema.parse(
        (await acme.admin.agent.get(`${api}/roles/${child.id}`)).body,
      );
      expect(now.parentId).toBe(acme.roleIds.manager);
    });

    it('audits moves with ids only', async () => {
      const role = await make(acme.admin, 'Quokka Mover', []);
      await move(hr, role.id, acme.roleIds.hr);
      const row = await system.auditLog.findFirst({
        where: { tenantId: acme.tenantId, entityId: role.id, action: 'role.moved' },
      });
      expect(row).toMatchObject({
        actorUserId: hr.id,
        before: { parentId: null },
        after: { parentId: acme.roleIds.hr },
      });
      expect(JSON.stringify(row)).not.toMatch(/Quokka/);
    });
  });

  describe('nobody assigns a custom role they could not have built (ADR 0036)', () => {
    it('Admin cannot hand out a role HR built with a permission Admin lacks', async () => {
      const reader = await make(hr, 'Feedback reader', [g(NOT_ADMINS, 'all')]);
      const res = await acme.admin.agent
        .put(`${api}/users/${dan.id}/roles`)
        .send({ roleIds: [acme.roleIds.employee, reader.id] });
      expect(res.status).toBe(403);
      expect(errorBody(res).details?.[0]).toMatchObject({ code: 'cannot_assign' });
      // not to themselves either, and not with an invitation
      const self = await acme.admin.agent
        .put(`${api}/users/${acme.admin.id}/roles`)
        .send({ roleIds: [acme.roleIds.admin, reader.id] });
      expect(self.status).toBe(403);
      const invite = await acme.admin.agent
        .post(`${api}/users/invitations`)
        .send({ email: 'reader@acme.eu', roleIds: [reader.id] });
      expect(invite.status).toBe(403);
      expect(await system.userRole.count({ where: { roleId: reader.id } })).toBe(0);
      // system roles are exempt: Admin can still make someone HR
      const toHr = await acme.admin.agent
        .put(`${api}/users/${dan.id}/roles`)
        .send({ roleIds: [acme.roleIds.hr] });
      expect(toHr.status, JSON.stringify(toHr.body)).toBe(200);
      await give(acme, dan, acme.roleIds.employee);
    });

    it('checks only roles that are new for the person', async () => {
      const wide = await make(acme.admin, 'Wide approver', [g(SCHEDULE, 'all')]);
      const assigner = await make(acme.admin, 'Assigner', [
        g('admin.role.assign', 'all'),
        g(SCHEDULE, 'team'),
      ]);
      const delegate = await onboard(acme);
      await give(acme, delegate, acme.roleIds.employee, assigner.id);
      const someone = await onboard(acme);
      const refused = await delegate.agent
        .put(`${api}/users/${someone.id}/roles`)
        .send({ roleIds: [acme.roleIds.employee, wide.id] });
      expect(refused.status).toBe(403);
      await give(acme, someone, acme.roleIds.employee, wide.id);
      // keeping a role the person already has is fine, while adding a system role
      const kept = await delegate.agent
        .put(`${api}/users/${someone.id}/roles`)
        .send({ roleIds: [acme.roleIds.employee, acme.roleIds.manager, wide.id] });
      expect(kept.status, JSON.stringify(kept.body)).toBe(200);
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
      await create(dan, { name: 'Nope', grants: [] });
      expect(
        await system.auditLog.count({
          where: { tenantId: acme.tenantId, action: { startsWith: 'role.' } },
        }),
      ).toBe(before);
    });
  });
});
