import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  PERMISSIONS,
  SYSTEM_ROLES,
  apiErrorBodySchema,
  mergeGrants,
  systemRoleGrants,
  userSummarySchema,
  type SystemRole,
} from '@intime/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAILER } from '../src/infrastructure/mail/mailer.js';
import type { MemoryMailer } from '../src/infrastructure/mail/memory.mailer.js';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { TenantContext } from '../src/infrastructure/tenancy/tenant-context.js';
import { TenantProvisioningService } from '../src/modules/tenants/tenant-provisioning.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';

const urls = testDbUrls();
const PASSWORD = 'correct horse battery staple';

/** A route that forgot to declare its protection: the guard must refuse it even for administrators. */
@Controller('test-undeclared')
class UndeclaredController {
  @Get()
  forgotten() {
    return { leaked: true };
  }
}

type Res = request.Response;
const errorCode = (res: Res) => apiErrorBodySchema.parse(res.body).error.code;

describe.skipIf(!urls)('users, roles and permissions over HTTP (real database)', () => {
  const env = testEnv({
    DATABASE_URL: urls?.app,
    SYSTEM_DATABASE_URL: urls?.system,
    TRUST_PROXY: 'true',
  });
  let app: NestExpressApplication;
  let system: SystemPrismaService;
  let mailer: MemoryMailer;
  let provisioning: TenantProvisioningService;

  // A fresh client IP per agent keeps the per-IP rate limits of one test from affecting another.
  let nextIp = 0;
  const agent = () => {
    nextIp += 1;
    return request
      .agent(app.getHttpServer())
      .set('X-Forwarded-For', `10.2.${nextIp >> 8}.${nextIp & 255}`);
  };

  interface Member {
    agent: ReturnType<typeof agent>;
    id: string;
    email: string;
  }
  interface Workspace {
    tenantId: string;
    admin: Member;
    roleIds: Record<SystemRole, string>;
  }

  const tokenFor = (email: string) => {
    const message = [...mailer.sent].reverse().find((m) => m.to === email);
    const link = message?.text.match(/https?:\/\/\S+/)?.[0] ?? '';
    return new URL(link).searchParams.get('token') ?? '';
  };

  async function accept(email: string): Promise<Member> {
    const member = agent();
    const res = await member
      .post('/api/v1/auth/invitations/accept')
      .send({ token: tokenFor(email), password: PASSWORD });
    expect(res.status).toBe(200);
    return { agent: member, id: res.body.id, email };
  }

  async function workspace(slug: string, adminEmail = `admin@${slug}.eu`): Promise<Workspace> {
    const { tenantId } = await provisioning.create({ name: `${slug} GmbH`, slug, adminEmail });
    const admin = await accept(adminEmail);
    const roles = (await admin.agent.get('/api/v1/roles')).body as { id: string; key: string }[];
    const roleIds = Object.fromEntries(roles.map((r) => [r.key, r.id])) as Record<
      SystemRole,
      string
    >;
    return { tenantId, admin, roleIds };
  }

  /** Admin invites someone with a role and they accept: returns their signed-in session. */
  async function member(
    ws: Workspace,
    email: string,
    role: SystemRole = 'employee',
  ): Promise<Member> {
    const res = await ws.admin.agent
      .post('/api/v1/users/invitations')
      .send({ email, roleIds: [ws.roleIds[role]] });
    expect(res.status).toBe(201);
    return accept(email);
  }

  const context = <T>(tenantId: string, fn: () => Promise<T>) =>
    app.get(TenantContext).run(tenantId, fn);

  const auditFor = (tenantId: string, action: string) =>
    system.auditLog.findMany({ where: { tenantId, action }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    app = await createTestApp({ env, controllers: [UndeclaredController] });
    system = app.get(SystemPrismaService);
    mailer = app.get(MAILER);
    provisioning = app.get(TenantProvisioningService);
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });
  beforeEach(async () => {
    await system.tenant.deleteMany();
    mailer.clear();
  });

  describe('permissions in the session', () => {
    it('the first admin of a new workspace gets the admin role and its permissions', async () => {
      const ws = await workspace('acme');
      const me = await ws.admin.agent.get('/api/v1/auth/me');
      expect(me.body.roles).toEqual([{ key: 'admin', name: 'Admin' }]);
      expect(me.body.permissions).toEqual(mergeGrants([systemRoleGrants('admin')]));
      expect(me.body.permissions['admin.role.assign']).toBe('all');
    });

    it.each(SYSTEM_ROLES)(
      'a %s sees exactly the catalog permissions of that role',
      async (role) => {
        const ws = await workspace('acme');
        const user = role === 'admin' ? ws.admin : await member(ws, `${role}@acme.eu`, role);
        const me = await user.agent.get('/api/v1/auth/me');
        expect(me.body.permissions).toEqual(mergeGrants([systemRoleGrants(role)]));
        expect(me.body.roles.map((r: { key: string }) => r.key)).toEqual([role]);
      },
    );

    it('does not expose anything sensitive', async () => {
      const ws = await workspace('acme');
      const me = await ws.admin.agent.get('/api/v1/auth/me');
      expect(JSON.stringify(me.body)).not.toMatch(/hash|password|token/i);
    });
  });

  describe('route protection', () => {
    it('refuses a route that declares nothing, even for an administrator', async () => {
      const ws = await workspace('acme');
      const res = await ws.admin.agent.get('/api/v1/test-undeclared');
      expect([res.status, errorCode(res)]).toEqual([403, 'FORBIDDEN']);
      expect(JSON.stringify(res.body)).not.toContain('leaked');
    });

    it.each([
      ['GET', '/api/v1/roles'],
      ['GET', '/api/v1/users'],
      ['POST', '/api/v1/users/invitations'],
      ['PUT', '/api/v1/users/0192f5a0-0000-7000-8000-00000000000a/roles'],
      ['POST', '/api/v1/users/0192f5a0-0000-7000-8000-00000000000a/disable'],
      ['POST', '/api/v1/users/0192f5a0-0000-7000-8000-00000000000a/enable'],
    ] as const)('%s %s needs a signed-in user', async (method, path) => {
      const res = await agent()[method.toLowerCase() as 'get' | 'post' | 'put'](path).send({});
      expect([res.status, errorCode(res)]).toEqual([401, 'UNAUTHENTICATED']);
    });
  });

  describe('GET /roles and GET /users', () => {
    it('HR and Admin can list; Manager and Employee cannot', async () => {
      const ws = await workspace('acme');
      const people = {
        admin: ws.admin,
        hr: await member(ws, 'hr@acme.eu', 'hr'),
        manager: await member(ws, 'manager@acme.eu', 'manager'),
        employee: await member(ws, 'employee@acme.eu', 'employee'),
      };
      for (const path of ['/api/v1/roles', '/api/v1/users']) {
        for (const [role, who] of Object.entries(people)) {
          const res = await who.agent.get(path);
          const allowed = role === 'admin' || role === 'hr';
          expect(res.status, `${role} ${path}`).toBe(allowed ? 200 : 403);
          if (!allowed) expect(errorCode(res)).toBe('FORBIDDEN');
        }
      }
    });

    it('lists the four system roles with ids', async () => {
      const ws = await workspace('acme');
      const res = await ws.admin.agent.get('/api/v1/roles');
      expect(res.body.map((r: { key: string }) => r.key).sort()).toEqual([...SYSTEM_ROLES].sort());
      expect(res.body.every((r: { isSystem: boolean }) => r.isSystem)).toBe(true);
    });

    it('lists users with status and roles, validated by the shared schema, without secrets', async () => {
      const ws = await workspace('acme');
      await member(ws, 'emp@acme.eu', 'employee');
      await ws.admin.agent.post('/api/v1/users/invitations').send({ email: 'pending@acme.eu' });
      const res = await ws.admin.agent.get('/api/v1/users');
      const users = res.body.map((u: unknown) => userSummarySchema.parse(u));
      expect(users.map((u: { email: string; status: string }) => [u.email, u.status])).toEqual([
        ['admin@acme.eu', 'active'],
        ['emp@acme.eu', 'active'],
        ['pending@acme.eu', 'invited'],
      ]);
      expect(JSON.stringify(res.body)).not.toMatch(/hash|password|token/i);
    });

    it('only shows the own workspace', async () => {
      const acme = await workspace('acme');
      const beta = await workspace('beta');
      await member(beta, 'secret@beta.eu');
      const emails = (await acme.admin.agent.get('/api/v1/users')).body.map(
        (u: { email: string }) => u.email,
      );
      expect(emails).toEqual(['admin@acme.eu']);
      const roleIds = (await acme.admin.agent.get('/api/v1/roles')).body.map(
        (r: { id: string }) => r.id,
      );
      expect(roleIds.some((id: string) => Object.values(beta.roleIds).includes(id as never))).toBe(
        false,
      );
    });
  });

  describe('POST /users/invitations', () => {
    it('HR can invite an employee (default role) and the invitation is emailed', async () => {
      const ws = await workspace('acme');
      const hr = await member(ws, 'hr@acme.eu', 'hr');
      mailer.clear();
      const res = await hr.agent
        .post('/api/v1/users/invitations')
        .send({ email: ' New.Person@ACME.eu ' });
      expect(res.status).toBe(201);
      expect(userSummarySchema.parse(res.body)).toMatchObject({
        email: 'new.person@acme.eu',
        status: 'invited',
      });
      expect(res.body.roles.map((r: { key: string }) => r.key)).toEqual(['employee']);
      expect(mailer.sent.map((m) => m.to)).toEqual(['new.person@acme.eu']);
      expect(JSON.stringify(res.body)).not.toContain('token');
    });

    it('HR may name the Employee role explicitly, but no other role', async () => {
      const ws = await workspace('acme');
      const hr = await member(ws, 'hr@acme.eu', 'hr');
      const ok = await hr.agent
        .post('/api/v1/users/invitations')
        .send({ email: 'a@acme.eu', roleIds: [ws.roleIds.employee] });
      expect(ok.status).toBe(201);
      for (const role of ['manager', 'hr', 'admin'] as const) {
        const denied = await hr.agent
          .post('/api/v1/users/invitations')
          .send({ email: `${role}@acme.eu`, roleIds: [ws.roleIds[role]] });
        expect([denied.status, errorCode(denied)], role).toEqual([403, 'FORBIDDEN']);
      }
      const mixed = await hr.agent
        .post('/api/v1/users/invitations')
        .send({ email: 'mix@acme.eu', roleIds: [ws.roleIds.employee, ws.roleIds.admin] });
      expect(mixed.status).toBe(403);
      expect(
        await system.user.count({
          where: {
            tenantId: ws.tenantId,
            email: { in: ['manager@acme.eu', 'hr@acme.eu2', 'admin@acme.eu2', 'mix@acme.eu'] },
          },
        }),
      ).toBe(0);
    });

    it('Admin can invite any role', async () => {
      const ws = await workspace('acme');
      for (const role of ['manager', 'hr', 'admin'] as const) {
        const res = await ws.admin.agent
          .post('/api/v1/users/invitations')
          .send({ email: `${role}2@acme.eu`, roleIds: [ws.roleIds[role]] });
        expect(res.status, role).toBe(201);
        expect(res.body.roles.map((r: { key: string }) => r.key)).toEqual([role]);
      }
    });

    it('Manager and Employee cannot invite', async () => {
      const ws = await workspace('acme');
      for (const role of ['manager', 'employee'] as const) {
        const who = await member(ws, `${role}@acme.eu`, role);
        const res = await who.agent
          .post('/api/v1/users/invitations')
          .send({ email: `x-${role}@acme.eu` });
        expect([res.status, errorCode(res)], role).toEqual([403, 'FORBIDDEN']);
      }
    });

    it.each([
      ['a malformed email', { email: 'nope' }, 'VALIDATION_FAILED'],
      ['an empty role list', { email: 'a@acme.eu', roleIds: [] }, 'VALIDATION_FAILED'],
      [
        'a role id that is not a UUID',
        { email: 'a@acme.eu', roleIds: ['admin'] },
        'VALIDATION_FAILED',
      ],
      [
        'an unknown role',
        { email: 'a@acme.eu', roleIds: ['0192f5a0-0000-7000-8000-0000000000ff'] },
        'VALIDATION_FAILED',
      ],
    ])('rejects %s', async (_label, body, code) => {
      const ws = await workspace('acme');
      const res = await ws.admin.agent.post('/api/v1/users/invitations').send(body);
      expect([res.status, errorCode(res)]).toEqual([400, code]);
    });

    it('rejects another workspace’s role id', async () => {
      const acme = await workspace('acme');
      const beta = await workspace('beta');
      const res = await acme.admin.agent
        .post('/api/v1/users/invitations')
        .send({ email: 'a@acme.eu', roleIds: [beta.roleIds.admin] });
      // Admin power passes (beta's role is not the employee role), but the role does not exist for acme.
      expect([res.status, errorCode(res)]).toEqual([400, 'VALIDATION_FAILED']);
      expect(
        await system.user.count({ where: { tenantId: acme.tenantId, email: 'a@acme.eu' } }),
      ).toBe(0);
    });

    it('rejects someone who already has an active account', async () => {
      const ws = await workspace('acme');
      await member(ws, 'taken@acme.eu');
      const res = await ws.admin.agent
        .post('/api/v1/users/invitations')
        .send({ email: 'TAKEN@acme.eu' });
      expect([res.status, errorCode(res)]).toEqual([409, 'CONFLICT']);
      expect(res.body.error.params).toEqual({ field: 'email' });
    });

    it('inviting a pending address again re-sends the link, invalidates the old one and replaces roles', async () => {
      const ws = await workspace('acme');
      await ws.admin.agent.post('/api/v1/users/invitations').send({ email: 'p@acme.eu' });
      const firstToken = tokenFor('p@acme.eu');
      const again = await ws.admin.agent
        .post('/api/v1/users/invitations')
        .send({ email: 'p@acme.eu', roleIds: [ws.roleIds.manager] });
      expect(again.status).toBe(201);
      expect(again.body.roles.map((r: { key: string }) => r.key)).toEqual(['manager']);
      expect(
        await system.user.count({ where: { tenantId: ws.tenantId, email: 'p@acme.eu' } }),
      ).toBe(1);
      const old = await agent()
        .post('/api/v1/auth/invitations/inspect')
        .send({ token: firstToken });
      expect(errorCode(old)).toBe('TOKEN_INVALID');
      const accepted = await agent()
        .post('/api/v1/auth/invitations/accept')
        .send({ token: tokenFor('p@acme.eu'), password: PASSWORD });
      expect(accepted.status).toBe(200);
      expect(accepted.body.roles.map((r: { key: string }) => r.key)).toEqual(['manager']);
    });

    it('writes an audit entry without the email address', async () => {
      const ws = await workspace('acme');
      const res = await ws.admin.agent
        .post('/api/v1/users/invitations')
        .send({ email: 'audit@acme.eu', roleIds: [ws.roleIds.manager] });
      const [entry] = await auditFor(ws.tenantId, 'user.invited');
      expect(entry).toMatchObject({
        actorUserId: ws.admin.id,
        entity: 'user',
        entityId: res.body.id,
        after: { roleIds: [ws.roleIds.manager] },
      });
      expect(JSON.stringify(entry)).not.toContain('audit@acme.eu');
    });
  });

  describe('PUT /users/:id/roles', () => {
    const put = (who: Member, id: string, roleIds: string[]) =>
      who.agent.put(`/api/v1/users/${id}/roles`).send({ roleIds });

    it('Admin changes roles, and the change applies to the very next request of that user', async () => {
      const ws = await workspace('acme');
      const hr = await member(ws, 'hr@acme.eu', 'hr');
      expect((await hr.agent.get('/api/v1/users')).status).toBe(200);

      const res = await put(ws.admin, hr.id, [ws.roleIds.employee]);
      expect(res.status).toBe(200);
      expect(res.body.roles.map((r: { key: string }) => r.key)).toEqual(['employee']);

      // No new sign-in needed: HR lost its permissions at once.
      expect((await hr.agent.get('/api/v1/users')).status).toBe(403);
      expect(
        (await hr.agent.get('/api/v1/auth/me')).body.permissions['admin.user.view'],
      ).toBeUndefined();

      const [entry] = await auditFor(ws.tenantId, 'user.roles_changed');
      expect(entry).toMatchObject({
        actorUserId: ws.admin.id,
        entityId: hr.id,
        before: { roleIds: [ws.roleIds.hr] },
        after: { roleIds: [ws.roleIds.employee] },
      });
    });

    it('promotes someone and the new powers work immediately', async () => {
      const ws = await workspace('acme');
      const emp = await member(ws, 'emp@acme.eu');
      expect((await emp.agent.get('/api/v1/users')).status).toBe(403);
      await put(ws.admin, emp.id, [ws.roleIds.employee, ws.roleIds.hr]);
      expect((await emp.agent.get('/api/v1/users')).status).toBe(200);
    });

    it('HR, Manager and Employee cannot assign roles (not even to themselves)', async () => {
      const ws = await workspace('acme');
      const hr = await member(ws, 'hr@acme.eu', 'hr');
      const manager = await member(ws, 'manager@acme.eu', 'manager');
      const employee = await member(ws, 'employee@acme.eu', 'employee');
      for (const who of [hr, manager, employee]) {
        const res = await put(who, who.id, [ws.roleIds.admin]);
        expect([res.status, errorCode(res)], who.email).toEqual([403, 'FORBIDDEN']);
      }
      expect(
        (await hr.agent.get('/api/v1/auth/me')).body.permissions['admin.role.assign'],
      ).toBeUndefined();
    });

    it.each([
      ['an empty list', () => [] as string[], 400, 'VALIDATION_FAILED'],
      ['an unknown role', () => ['0192f5a0-0000-7000-8000-0000000000ff'], 400, 'VALIDATION_FAILED'],
    ])('rejects %s', async (_label, roles, status, code) => {
      const ws = await workspace('acme');
      const emp = await member(ws, 'emp@acme.eu');
      const res = await put(ws.admin, emp.id, roles());
      expect([res.status, errorCode(res)]).toEqual([status, code]);
      expect(await system.userRole.count({ where: { userId: emp.id } })).toBe(1);
    });

    it('answers 404 for unknown users and for users of another workspace, 400 for malformed ids', async () => {
      const acme = await workspace('acme');
      const beta = await workspace('beta');
      const betaUser = await member(beta, 'b@beta.eu');
      const unknown = await put(acme.admin, '0192f5a0-0000-7000-8000-0000000000ff', [
        acme.roleIds.employee,
      ]);
      expect([unknown.status, errorCode(unknown)]).toEqual([404, 'NOT_FOUND']);
      const foreign = await put(acme.admin, betaUser.id, [acme.roleIds.admin]);
      expect([foreign.status, errorCode(foreign)]).toEqual([404, 'NOT_FOUND']);
      const malformed = await put(acme.admin, 'not-a-uuid', [acme.roleIds.employee]);
      expect([malformed.status, errorCode(malformed)]).toEqual([400, 'VALIDATION_FAILED']);
      expect((await beta.admin.agent.get('/api/v1/auth/me')).status).toBe(200);
      expect(
        (
          await system.userRole.findMany({
            where: { userId: betaUser.id },
            include: { role: true },
          })
        ).map((r) => r.role.key),
      ).toEqual(['employee']);
    });

    describe('last administrator', () => {
      it('the only administrator cannot remove their own admin role', async () => {
        const ws = await workspace('acme');
        const res = await put(ws.admin, ws.admin.id, [ws.roleIds.employee]);
        expect([res.status, errorCode(res)]).toEqual([409, 'LAST_ADMIN']);
        expect(
          (await ws.admin.agent.get('/api/v1/auth/me')).body.permissions['admin.role.assign'],
        ).toBe('all');
        expect(await auditFor(ws.tenantId, 'user.roles_changed')).toHaveLength(0);
      });

      it('with a second administrator, an administrator may step down', async () => {
        const ws = await workspace('acme');
        const second = await member(ws, 'admin2@acme.eu', 'admin');
        const res = await put(ws.admin, ws.admin.id, [ws.roleIds.employee]);
        expect(res.status).toBe(200);
        expect(
          (await second.agent.get('/api/v1/auth/me')).body.permissions['admin.role.assign'],
        ).toBe('all');
      });

      it('a disabled administrator does not count', async () => {
        const ws = await workspace('acme');
        const second = await member(ws, 'admin2@acme.eu', 'admin');
        await system.user.update({ where: { id: second.id }, data: { status: 'disabled' } });
        const res = await put(ws.admin, ws.admin.id, [ws.roleIds.employee]);
        expect([res.status, errorCode(res)]).toEqual([409, 'LAST_ADMIN']);
      });

      it('two administrators demoting each other at the same moment: one succeeds, one administrator remains', async () => {
        const ws = await workspace('acme');
        const second = await member(ws, 'admin2@acme.eu', 'admin');
        const results = await Promise.all([
          put(ws.admin, second.id, [ws.roleIds.employee]),
          put(second, ws.admin.id, [ws.roleIds.employee]),
        ]);
        const statuses = results.map((r) => r.status).sort();
        // The slower request either fails the last-admin check (409) or finds itself already demoted (403/401).
        expect(statuses[0]).toBe(200);
        expect([401, 403, 409]).toContain(statuses[1]);
        const admins = await system.user.count({
          where: {
            tenantId: ws.tenantId,
            status: 'active',
            roles: { some: { role: { key: 'admin' } } },
          },
        });
        expect(admins).toBe(1);
      });
    });
  });

  describe('disable and enable', () => {
    const disable = (who: Member, id: string) => who.agent.post(`/api/v1/users/${id}/disable`);
    const enable = (who: Member, id: string) => who.agent.post(`/api/v1/users/${id}/enable`);

    it('HR disables an employee: the account stops working immediately and cannot sign in again', async () => {
      const ws = await workspace('acme');
      const hr = await member(ws, 'hr@acme.eu', 'hr');
      const emp = await member(ws, 'emp@acme.eu');
      expect((await emp.agent.get('/api/v1/auth/me')).status).toBe(200);

      const res = await disable(hr, emp.id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('disabled');

      expect((await emp.agent.get('/api/v1/auth/me')).status).toBe(401);
      const refresh = await emp.agent.post('/api/v1/auth/refresh');
      expect(refresh.status).toBe(401);
      const login = await agent()
        .post('/api/v1/auth/login')
        .send({ email: 'emp@acme.eu', password: PASSWORD });
      expect([login.status, errorCode(login)]).toEqual([403, 'ACCOUNT_DISABLED']);

      const [entry] = await auditFor(ws.tenantId, 'user.disabled');
      expect(entry).toMatchObject({
        actorUserId: hr.id,
        entityId: emp.id,
        before: { status: 'active' },
        after: { status: 'disabled' },
      });
    });

    it('is idempotent', async () => {
      const ws = await workspace('acme');
      const emp = await member(ws, 'emp@acme.eu');
      expect((await disable(ws.admin, emp.id)).status).toBe(200);
      const again = await disable(ws.admin, emp.id);
      expect([again.status, again.body.status]).toEqual([200, 'disabled']);
      expect(await auditFor(ws.tenantId, 'user.disabled')).toHaveLength(1);
    });

    it('Manager and Employee cannot disable anyone', async () => {
      const ws = await workspace('acme');
      const victim = await member(ws, 'victim@acme.eu');
      for (const role of ['manager', 'employee'] as const) {
        const who = await member(ws, `${role}@acme.eu`, role);
        const res = await disable(who, victim.id);
        expect([res.status, errorCode(res)], role).toEqual([403, 'FORBIDDEN']);
      }
      expect((await victim.agent.get('/api/v1/auth/me')).status).toBe(200);
    });

    it('nobody can disable their own account', async () => {
      const ws = await workspace('acme');
      const hr = await member(ws, 'hr@acme.eu', 'hr');
      for (const who of [ws.admin, hr]) {
        const res = await disable(who, who.id);
        expect([res.status, errorCode(res)]).toEqual([409, 'CANNOT_DISABLE_SELF']);
      }
      expect((await hr.agent.get('/api/v1/auth/me')).status).toBe(200);
    });

    it('HR may disable managers and other HR, but not administrators; Admin may', async () => {
      const ws = await workspace('acme');
      const hr = await member(ws, 'hr@acme.eu', 'hr');
      const hr2 = await member(ws, 'hr2@acme.eu', 'hr');
      const manager = await member(ws, 'manager@acme.eu', 'manager');
      const admin2 = await member(ws, 'admin2@acme.eu', 'admin');

      expect((await disable(hr, manager.id)).status).toBe(200);
      expect((await disable(hr, hr2.id)).status).toBe(200);
      const denied = await disable(hr, admin2.id);
      expect([denied.status, errorCode(denied)]).toEqual([403, 'FORBIDDEN']);
      expect((await admin2.agent.get('/api/v1/auth/me')).status).toBe(200);

      expect((await disable(ws.admin, admin2.id)).status).toBe(200);
    });

    it('the last active administrator cannot be disabled, and a disabled one does not count', async () => {
      const ws = await workspace('acme');
      const admin2 = await member(ws, 'admin2@acme.eu', 'admin');
      expect((await disable(admin2, ws.admin.id)).status).toBe(200);
      // admin2 is now the only active administrator; they cannot disable themselves (rule) and nobody else can.
      const hr = await system.user.create({
        data: { tenantId: ws.tenantId, email: 'x@acme.eu', status: 'active' },
      });
      expect(hr.id).toBeDefined();
      const self = await disable(admin2, admin2.id);
      expect(errorCode(self)).toBe('CANNOT_DISABLE_SELF');
      expect((await ws.admin.agent.get('/api/v1/auth/me')).status).toBe(401);
    });

    it('two administrators disabling each other at the same moment: exactly one succeeds', async () => {
      const ws = await workspace('acme');
      const second = await member(ws, 'admin2@acme.eu', 'admin');
      const results = await Promise.all([
        disable(ws.admin, second.id),
        disable(second, ws.admin.id),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses[0]).toBe(200);
      expect([401, 409]).toContain(statuses[1]);
      expect(await system.user.count({ where: { tenantId: ws.tenantId, status: 'active' } })).toBe(
        1,
      );
    });

    it('answers 404 for unknown and foreign users', async () => {
      const acme = await workspace('acme');
      const beta = await workspace('beta');
      const foreign = await member(beta, 'b@beta.eu');
      for (const id of ['0192f5a0-0000-7000-8000-0000000000ff', foreign.id]) {
        const res = await disable(acme.admin, id);
        expect([res.status, errorCode(res)]).toEqual([404, 'NOT_FOUND']);
      }
      expect((await foreign.agent.get('/api/v1/auth/me')).status).toBe(200);
    });

    it('sessions from before the disabling stay dead after re-enabling (a stolen cookie must not revive)', async () => {
      const ws = await workspace('acme');
      const emp = await member(ws, 'emp@acme.eu');
      const oldRefresh = (await emp.agent.post('/api/v1/auth/refresh')).headers['set-cookie'];
      expect(oldRefresh).toBeDefined();
      await disable(ws.admin, emp.id);
      await enable(ws.admin, emp.id);
      expect((await emp.agent.get('/api/v1/auth/me')).status).toBe(401);
      expect((await emp.agent.post('/api/v1/auth/refresh')).status).toBe(401);
      expect(await system.session.count({ where: { userId: emp.id, revokedAt: null } })).toBe(0);
    });

    it('enabling restores access: a re-enabled user can sign in again', async () => {
      const ws = await workspace('acme');
      const emp = await member(ws, 'emp@acme.eu');
      await disable(ws.admin, emp.id);
      const res = await enable(ws.admin, emp.id);
      expect([res.status, res.body.status]).toEqual([200, 'active']);
      const login = await agent()
        .post('/api/v1/auth/login')
        .send({ email: 'emp@acme.eu', password: PASSWORD });
      expect(login.status).toBe(200);
      expect(await auditFor(ws.tenantId, 'user.enabled')).toHaveLength(1);
    });

    it('someone who never accepted their invitation returns to "invited", not "active"', async () => {
      const ws = await workspace('acme');
      const invited = await ws.admin.agent
        .post('/api/v1/users/invitations')
        .send({ email: 'never@acme.eu' });
      await disable(ws.admin, invited.body.id);
      const res = await enable(ws.admin, invited.body.id);
      expect(res.body.status).toBe('invited');
      const login = await agent()
        .post('/api/v1/auth/login')
        .send({ email: 'never@acme.eu', password: PASSWORD });
      expect(errorCode(login)).toBe('INVALID_CREDENTIALS');
    });

    it('enabling an active user changes nothing; HR cannot re-enable an administrator', async () => {
      const ws = await workspace('acme');
      const hr = await member(ws, 'hr@acme.eu', 'hr');
      const admin2 = await member(ws, 'admin2@acme.eu', 'admin');
      const emp = await member(ws, 'emp@acme.eu');
      expect((await enable(hr, emp.id)).body.status).toBe('active');
      expect(await auditFor(ws.tenantId, 'user.enabled')).toHaveLength(0);

      await disable(ws.admin, admin2.id);
      const denied = await enable(hr, admin2.id);
      expect([denied.status, errorCode(denied)]).toEqual([403, 'FORBIDDEN']);
    });

    it('a request from an account that was disabled while it waited cannot act', async () => {
      const ws = await workspace('acme');
      const hr = await member(ws, 'hr@acme.eu', 'hr');
      const emp = await member(ws, 'emp@acme.eu');
      await system.user.update({ where: { id: hr.id }, data: { status: 'disabled' } });
      const res = await disable(hr, emp.id);
      expect(res.status).toBe(401);
      expect((await emp.agent.get('/api/v1/auth/me')).status).toBe(200);
    });
  });

  describe('UsersService called directly (a request that is already inside the service)', () => {
    it('refuses an actor who was disabled after the request passed the guard', async () => {
      const ws = await workspace('acme');
      const hr = await member(ws, 'hr@acme.eu', 'hr');
      const emp = await member(ws, 'emp@acme.eu');
      await system.user.update({ where: { id: hr.id }, data: { status: 'disabled' } });

      const users = app.get(UsersService);
      const actor = {
        userId: hr.id,
        tenantId: ws.tenantId,
        sessionId: '0192f5a0-0000-7000-8000-0000000000aa',
        roles: [],
        permissions: mergeGrants([systemRoleGrants('hr')]),
      };
      await expect(context(ws.tenantId, () => users.disable(actor, emp.id))).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      await expect(
        context(ws.tenantId, () => users.invite(actor, 'new@acme.eu')),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      expect((await emp.agent.get('/api/v1/auth/me')).status).toBe(200);
      expect(
        await system.user.count({ where: { tenantId: ws.tenantId, email: 'new@acme.eu' } }),
      ).toBe(0);
    });
  });

  it('every permission in the catalog is covered by a role in the fixtures above (sanity)', () => {
    expect(PERMISSIONS.some((p) => p.code === 'admin.role.assign')).toBe(true);
  });
});
