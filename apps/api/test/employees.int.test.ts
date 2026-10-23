import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiErrorBodySchema, employeeListSchema, employeeSchema } from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { TenantContext, type TenantTx } from '../src/infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../src/infrastructure/tenancy/tenant-db.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import {
  PASSWORD,
  httpWorkspaceHelpers,
  type Member,
  type Workspace,
} from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;

describe.skipIf(!urls)('employees over HTTP (real database)', () => {
  const env = testEnv({
    DATABASE_URL: urls?.app,
    SYSTEM_DATABASE_URL: urls?.system,
    TRUST_PROXY: 'true',
  });
  let app: NestExpressApplication;
  let system: SystemPrismaService;
  const { agent, workspace, member, accept, mailer } = httpWorkspaceHelpers(() => app);

  let acme: Workspace;
  let globex: Workspace;
  let hr: Member;
  let manager: Member;
  let staff: Member;
  /** An employee with a finished account, created and invited by HR. */
  let ada: Member & { employeeId: string };

  const asTenant = <T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>) =>
    app.get(TenantContext).run(tenantId, () => app.get(TenantDb).tx(fn));

  const create = (who: Member, body: object) => who.agent.post('/api/v1/employees').send(body);
  const base = { firstName: 'Grace', lastName: 'Hopper', employmentType: 'full_time' };

  async function onboard(
    ws: Workspace,
    by: Member,
    email: string,
    extra: object = {},
  ): Promise<Member & { employeeId: string }> {
    const res = await create(by, { ...base, firstName: email.split('@')[0], email, ...extra });
    expect(res.status).toBe(201);
    const who = await accept(email);
    return { ...who, employeeId: employeeSchema.parse(res.body).id };
  }

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    hr = await member(acme, 'hr@acme.eu', 'hr');
    manager = await member(acme, 'manager@acme.eu', 'manager');
    staff = await member(acme, 'staff@acme.eu', 'employee');
    ada = await onboard(acme, hr, 'ada@acme.eu', {
      lastName: 'Lovelace',
      jobTitle: 'Engineer',
      phone: '+359 88 123 4567',
      birthDate: '1990-12-10',
      hireDate: '2024-01-15',
      employeeNo: 'E-100',
      seniority: 'senior',
      country: 'BG',
    });
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  describe('creating', () => {
    it('creates an employee, invites the account and lets the person sign in to their own record', async () => {
      const email = 'new.hire@acme.eu';
      const before = mailer().sent.length;
      const res = await create(hr, { ...base, email, hireDate: '2026-11-01' });
      expect(res.status).toBe(201);
      const created = employeeSchema.parse(res.body);
      expect(created).toMatchObject({
        firstName: 'Grace',
        email,
        status: 'active',
        profile: { accountStatus: 'invited', hireDate: '2026-11-01', employmentType: 'full_time' },
      });
      expect(mailer().sent.length).toBe(before + 1);
      expect(mailer().sent.at(-1)?.to).toBe(email);

      const person = await accept(email);
      const own = await person.agent.get('/api/v1/employees/me');
      expect(own.status).toBe(200);
      expect(employeeSchema.parse(own.body)).toMatchObject({
        id: created.id,
        isSelf: true,
        profile: { accountStatus: 'active' },
      });
      // The new account has the Employee role only.
      expect((await person.agent.post('/api/v1/employees').send(base)).status).toBe(403);
    });

    it('creates an employee without an account and sends nothing', async () => {
      const before = mailer().sent.length;
      const res = await create(hr, {
        ...base,
        firstName: 'Contractor',
        employmentType: 'contractor',
      });
      expect(res.status).toBe(201);
      expect(employeeSchema.parse(res.body)).toMatchObject({
        email: null,
        profile: { accountStatus: null, employmentType: 'contractor' },
      });
      expect(mailer().sent.length).toBe(before);
    });

    it('gives the workspace administrator an employee record', async () => {
      const res = await acme.admin.agent.get('/api/v1/employees/me');
      expect(res.status).toBe(200);
      expect(employeeSchema.parse(res.body)).toMatchObject({
        firstName: 'Workspace',
        lastName: 'Administrator',
        isSelf: true,
      });
    });

    it.each([
      ['an employee', () => staff],
      ['a manager', () => manager],
    ])('is forbidden for %s', async (_label, who) => {
      const res = await create(who(), base);
      expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
    });

    it('requires a signed-in user', async () => {
      const res = await agent().post('/api/v1/employees').send(base);
      expect(res.status).toBe(401);
    });

    it.each([
      ['a missing name', { employmentType: 'full_time' }],
      ['an unknown field (mass assignment)', { ...base, status: 'inactive' }],
      ['a user id (mass assignment)', { ...base, userId: '0192f5a0-0000-7000-8000-00000000000a' }],
      ['a bad email', { ...base, email: 'nope' }],
      ['a bad date', { ...base, hireDate: '2026-02-30' }],
      ['a birth date in the future', { ...base, birthDate: '2999-01-01' }],
    ])('rejects %s', async (_label, body) => {
      const res = await create(hr, body);
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('rejects a duplicate employee number without sending an invitation', async () => {
      const before = mailer().sent.length;
      const res = await create(hr, { ...base, employeeNo: 'E-100', email: 'dup-no@acme.eu' });
      expect([res.status, errorBody(res).code, errorBody(res).params]).toEqual([
        409,
        'CONFLICT',
        { field: 'employeeNo' },
      ]);
      expect(mailer().sent.length).toBe(before);
      expect(await system.user.findFirst({ where: { email: 'dup-no@acme.eu' } })).toBeNull();
    });

    it('allows the same employee number in another workspace', async () => {
      const res = await create(globex.admin, { ...base, employeeNo: 'E-100' });
      expect(res.status).toBe(201);
    });

    it('rejects an email that already has an account and rolls everything back', async () => {
      const res = await create(hr, { ...base, email: 'staff@acme.eu', employeeNo: 'E-RB' });
      expect([res.status, errorBody(res).params]).toEqual([409, { field: 'email' }]);
      expect(await system.employee.findFirst({ where: { employeeNo: 'E-RB' } })).toBeNull();
    });

    it('rejects an invited address that already belongs to another employee', async () => {
      const first = await create(hr, { ...base, email: 'shared@acme.eu' });
      expect(first.status).toBe(201);
      const second = await create(hr, { ...base, email: 'Shared@acme.eu' });
      expect([second.status, errorBody(second).params]).toEqual([409, { field: 'email' }]);
    });

    it('does not let HR downgrade an invited administrator by re-inviting their address', async () => {
      const invited = await acme.admin.agent
        .post('/api/v1/users/invitations')
        .send({ email: 'future.admin@acme.eu', roleIds: [acme.roleIds.admin] });
      expect(invited.status).toBe(201);

      const hrTry = await create(hr, { ...base, email: 'future.admin@acme.eu' });
      expect([hrTry.status, errorBody(hrTry).code]).toEqual([403, 'FORBIDDEN']);

      const adminTry = await create(acme.admin, { ...base, email: 'future.admin@acme.eu' });
      expect(adminTry.status).toBe(201);
      const user = await system.user.findFirstOrThrow({
        where: { email: 'future.admin@acme.eu' },
        select: { roles: { select: { roleId: true } } },
      });
      expect(user.roles.map((r) => r.roleId)).toEqual([acme.roleIds.admin]);
    });
  });

  describe('directory and profile visibility', () => {
    it('shows everybody the directory without personal profile data', async () => {
      const res = await staff.agent.get('/api/v1/employees?pageSize=100');
      expect(res.status).toBe(200);
      const list = employeeListSchema.parse(res.body);
      const entry = list.items.find((e) => e.id === ada.employeeId);
      expect(entry).toMatchObject({
        firstName: 'ada',
        lastName: 'Lovelace',
        jobTitle: 'Engineer',
        email: 'ada@acme.eu',
        profile: null,
      });
      // The raw JSON must not carry the private values at all.
      expect(JSON.stringify(res.body)).not.toMatch(/1990-12-10|359 88 123|E-100/);
    });

    it('shows the person their own full profile and HR everybody’s', async () => {
      const own = employeeSchema.parse((await ada.agent.get('/api/v1/employees/me')).body);
      expect(own.profile).toMatchObject({
        phone: '+359 88 123 4567',
        birthDate: '1990-12-10',
        employeeNo: 'E-100',
        seniority: 'senior',
        country: 'BG',
      });
      const viaId = await ada.agent.get(`/api/v1/employees/${ada.employeeId}`);
      expect(employeeSchema.parse(viaId.body).profile).not.toBeNull();

      const seenByHr = await hr.agent.get(`/api/v1/employees/${ada.employeeId}`);
      expect(employeeSchema.parse(seenByHr.body).profile?.birthDate).toBe('1990-12-10');
    });

    it('hides the profile from colleagues and, until Organization exists, from managers', async () => {
      for (const who of [staff, manager]) {
        const res = await who.agent.get(`/api/v1/employees/${ada.employeeId}`);
        expect(res.status).toBe(200);
        expect(employeeSchema.parse(res.body).profile).toBeNull();
      }
    });

    it('hides the profile of an employee without an account from anyone below scope "all"', async () => {
      const res = await create(hr, {
        ...base,
        firstName: 'Ghost',
        employeeNo: 'E-GHOST',
        phone: '+49 30 1234567',
      });
      const id = employeeSchema.parse(res.body).id;
      expect(
        employeeSchema.parse((await manager.agent.get(`/api/v1/employees/${id}`)).body).profile,
      ).toBeNull();
      expect(
        employeeSchema.parse((await hr.agent.get(`/api/v1/employees/${id}`)).body).profile?.phone,
      ).toBe('+49 30 1234567');
    });

    it('searches by name, title and email, ignoring case and accents of nothing special', async () => {
      const find = async (q: string) =>
        employeeListSchema
          .parse((await staff.agent.get('/api/v1/employees').query({ q })).body)
          .items.map((e) => e.id);
      expect(await find('LOVELACE')).toContain(ada.employeeId);
      expect(await find('ada love')).toEqual([ada.employeeId]);
      expect(await find('engineer')).toContain(ada.employeeId);
      expect(await find('ada@acme')).toContain(ada.employeeId);
      expect(await find('nobody-by-this-name')).toEqual([]);
      // LIKE wildcards are plain characters.
      expect(await find('%')).toEqual([]);
      expect(await find('_')).toEqual([]);
      expect(await find('\\')).toEqual([]);
      expect(await find('a%e')).toEqual([]);
    });

    it('pages sorted by last name and reports the total', async () => {
      const page1 = employeeListSchema.parse(
        (await staff.agent.get('/api/v1/employees?pageSize=2&page=1')).body,
      );
      const page2 = employeeListSchema.parse(
        (await staff.agent.get('/api/v1/employees?pageSize=2&page=2')).body,
      );
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBeGreaterThan(4);
      expect(page2.items.every((e) => !page1.items.some((p) => p.id === e.id))).toBe(true);
      const names = [...page1.items, ...page2.items].map((e) => e.lastName);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
      const beyond = employeeListSchema.parse(
        (await staff.agent.get('/api/v1/employees?page=999')).body,
      );
      expect(beyond.items).toEqual([]);
    });

    it.each([
      ['page 0', '?page=0'],
      ['a page size above 100', '?pageSize=101'],
      ['an unknown status', '?status=deleted'],
    ])('rejects %s', async (_label, query) => {
      const res = await staff.agent.get(`/api/v1/employees${query}`);
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('rejects ids that are not UUIDs and unknown ids', async () => {
      expect((await staff.agent.get('/api/v1/employees/not-a-uuid')).status).toBe(400);
      const unknown = await staff.agent.get(
        '/api/v1/employees/0192f5a0-0000-7000-8000-00000000000a',
      );
      expect([unknown.status, errorBody(unknown).code]).toEqual([404, 'NOT_FOUND']);
    });

    it('answers 404 for the own record of an account without an employee', async () => {
      const lone = await member(acme, 'lone@acme.eu', 'employee');
      const res = await lone.agent.get('/api/v1/employees/me');
      expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
    });
  });

  describe('updating', () => {
    it('lets HR edit and audits only the names of the changed fields', async () => {
      const res = await hr.agent.patch(`/api/v1/employees/${ada.employeeId}`).send({
        jobTitle: 'Principal Engineer',
        phone: '+359 88 999 0000',
        seniority: 'principal',
      });
      expect(res.status).toBe(200);
      expect(employeeSchema.parse(res.body)).toMatchObject({
        jobTitle: 'Principal Engineer',
        profile: { phone: '+359 88 999 0000', seniority: 'principal' },
      });

      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: 'employee.updated', entityId: ada.employeeId },
      });
      const serialized = JSON.stringify(entries.map((e) => [e.before, e.after]));
      expect(serialized).toContain('jobTitle');
      expect(serialized).not.toMatch(/Principal|999|1990/);
    });

    it('clears optional values with null and treats an unchanged value as no change', async () => {
      const target = employeeSchema.parse(
        (await create(hr, { ...base, firstName: 'Clear', location: 'Sofia', employeeNo: 'E-CLR' }))
          .body,
      );
      const cleared = await hr.agent
        .patch(`/api/v1/employees/${target.id}`)
        .send({ location: null, employeeNo: null });
      expect(cleared.status).toBe(200);
      expect(employeeSchema.parse(cleared.body).location).toBeNull();

      const before = await system.auditLog.count({
        where: { entityId: target.id, action: 'employee.updated' },
      });
      const same = await hr.agent.patch(`/api/v1/employees/${target.id}`).send({ location: null });
      expect(same.status).toBe(200);
      expect(
        await system.auditLog.count({ where: { entityId: target.id, action: 'employee.updated' } }),
      ).toBe(before);
    });

    it('is forbidden for employees and managers, even for their own record', async () => {
      for (const who of [staff, manager, ada]) {
        const res = await who.agent
          .patch(`/api/v1/employees/${ada.employeeId}`)
          .send({ jobTitle: 'CEO' });
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      }
    });

    it.each([
      ['an empty update', {}],
      ['an email change', { email: 'other@acme.eu' }],
      ['a status change', { status: 'inactive' }],
      ['a blank name', { firstName: '  ' }],
      ['an unknown seniority', { seniority: 'wizard' }],
    ])('rejects %s', async (_label, body) => {
      const res = await hr.agent.patch(`/api/v1/employees/${ada.employeeId}`).send(body);
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('rejects an employee number that belongs to someone else', async () => {
      const other = employeeSchema.parse((await create(hr, { ...base, firstName: 'Num' })).body);
      const res = await hr.agent
        .patch(`/api/v1/employees/${other.id}`)
        .send({ employeeNo: 'E-100' });
      expect([res.status, errorBody(res).params]).toEqual([409, { field: 'employeeNo' }]);
      // Keeping your own number is not a conflict.
      expect(
        (await hr.agent.patch(`/api/v1/employees/${ada.employeeId}`).send({ employeeNo: 'E-100' }))
          .status,
      ).toBe(200);
    });

    it('lets a person change only their own phone number', async () => {
      const ok = await ada.agent.patch('/api/v1/employees/me').send({ phone: '+359 88 111 2222' });
      expect(ok.status).toBe(200);
      expect(employeeSchema.parse(ok.body).profile?.phone).toBe('+359 88 111 2222');

      for (const body of [
        { jobTitle: 'CEO' },
        { phone: 'call me' },
        {},
        { phone: null, status: 'inactive' },
      ]) {
        const res = await ada.agent.patch('/api/v1/employees/me').send(body);
        expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
      }
      const lone = await member(acme, 'lone2@acme.eu', 'employee');
      expect(
        (await lone.agent.patch('/api/v1/employees/me').send({ phone: '+49 30 1234567' })).status,
      ).toBe(404);
    });
  });

  describe('invitations', () => {
    it('invites an employee without an account, re-sends an open invitation and refuses an active account', async () => {
      const created = employeeSchema.parse(
        (await create(hr, { ...base, firstName: 'Later' })).body,
      );

      const missing = await hr.agent.post(`/api/v1/employees/${created.id}/invitation`).send({});
      expect([missing.status, errorBody(missing).code]).toEqual([400, 'VALIDATION_FAILED']);

      const first = await hr.agent
        .post(`/api/v1/employees/${created.id}/invitation`)
        .send({ email: 'later@acme.eu' });
      expect(first.status).toBe(200);
      expect(employeeSchema.parse(first.body).profile?.accountStatus).toBe('invited');

      const sent = mailer().sent.length;
      const again = await hr.agent.post(`/api/v1/employees/${created.id}/invitation`).send({});
      expect(again.status).toBe(200);
      expect(mailer().sent.length).toBe(sent + 1);

      const changed = await hr.agent
        .post(`/api/v1/employees/${created.id}/invitation`)
        .send({ email: 'other@acme.eu' });
      expect([changed.status, errorBody(changed).params]).toEqual([409, { field: 'email' }]);

      await accept('later@acme.eu');
      const late = await hr.agent.post(`/api/v1/employees/${created.id}/invitation`).send({});
      expect([late.status, errorBody(late).params]).toEqual([409, { field: 'account' }]);
    });

    it('is forbidden for employees', async () => {
      const res = await staff.agent.post(`/api/v1/employees/${ada.employeeId}/invitation`).send({});
      expect(res.status).toBe(403);
    });
  });

  describe('deactivating and reactivating', () => {
    it('ends the account immediately, keeps the record and can be undone', async () => {
      const leaver = await onboard(acme, hr, 'leaver@acme.eu', { hireDate: '2024-03-01' });
      expect((await leaver.agent.get('/api/v1/auth/me')).status).toBe(200);

      const res = await hr.agent
        .post(`/api/v1/employees/${leaver.employeeId}/deactivate`)
        .send({ terminationDate: '2026-10-31' });
      expect(res.status).toBe(200);
      expect(employeeSchema.parse(res.body)).toMatchObject({
        status: 'inactive',
        profile: { terminationDate: '2026-10-31', accountStatus: 'disabled' },
      });
      expect((await leaver.agent.get('/api/v1/auth/me')).status).toBe(401);
      const login = await agent()
        .post('/api/v1/auth/login')
        .send({ email: 'leaver@acme.eu', password: PASSWORD });
      expect([login.status, errorBody(login).code]).toEqual([403, 'ACCOUNT_DISABLED']);

      // Gone from the directory and from people who may not manage employees; visible to HR.
      expect(
        employeeListSchema
          .parse((await staff.agent.get('/api/v1/employees?pageSize=100')).body)
          .items.some((e) => e.id === leaver.employeeId),
      ).toBe(false);
      expect((await staff.agent.get(`/api/v1/employees/${leaver.employeeId}`)).status).toBe(404);
      expect((await staff.agent.get('/api/v1/employees?status=inactive')).status).toBe(403);
      const inactive = employeeListSchema.parse(
        (await hr.agent.get('/api/v1/employees?status=inactive')).body,
      );
      expect(inactive.items.map((e) => e.id)).toContain(leaver.employeeId);

      // Idempotent.
      expect(
        (await hr.agent.post(`/api/v1/employees/${leaver.employeeId}/deactivate`).send({})).status,
      ).toBe(200);

      const back = await hr.agent.post(`/api/v1/employees/${leaver.employeeId}/reactivate`);
      expect(back.status).toBe(200);
      expect(employeeSchema.parse(back.body)).toMatchObject({
        status: 'active',
        profile: { terminationDate: null, accountStatus: 'active' },
      });
      const again = await agent()
        .post('/api/v1/auth/login')
        .send({ email: 'leaver@acme.eu', password: PASSWORD });
      expect(again.status).toBe(200);

      const actions = (
        await system.auditLog.findMany({
          where: { entityId: leaver.employeeId },
          orderBy: { createdAt: 'asc' },
        })
      ).map((e) => e.action);
      expect(actions).toEqual(
        expect.arrayContaining(['employee.deactivated', 'employee.reactivated']),
      );
    });

    it('defaults the termination date to today and refuses one before the hire date', async () => {
      const target = employeeSchema.parse(
        (await create(hr, { ...base, firstName: 'Soon', hireDate: '2024-05-01' })).body,
      );
      const early = await hr.agent
        .post(`/api/v1/employees/${target.id}/deactivate`)
        .send({ terminationDate: '2024-04-30' });
      expect([early.status, errorBody(early).code]).toEqual([400, 'VALIDATION_FAILED']);
      const res = await hr.agent.post(`/api/v1/employees/${target.id}/deactivate`).send({});
      expect(employeeSchema.parse(res.body).profile?.terminationDate).toBe(
        new Date().toISOString().slice(0, 10),
      );
      // A later edit may not move the hire date behind the termination date.
      const edit = await hr.agent
        .patch(`/api/v1/employees/${target.id}`)
        .send({ hireDate: '2999-01-01' });
      expect([edit.status, errorBody(edit).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('deactivates an employee who never had an account', async () => {
      const target = employeeSchema.parse(
        (await create(hr, { ...base, firstName: 'NoAccount' })).body,
      );
      const res = await hr.agent.post(`/api/v1/employees/${target.id}/deactivate`).send({});
      expect(employeeSchema.parse(res.body).status).toBe('inactive');
    });

    it('is forbidden for employees and managers', async () => {
      for (const who of [staff, manager]) {
        const res = await who.agent.post(`/api/v1/employees/${ada.employeeId}/deactivate`).send({});
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      }
    });

    it('refuses to deactivate yourself', async () => {
      const own = employeeSchema.parse((await acme.admin.agent.get('/api/v1/employees/me')).body);
      const res = await acme.admin.agent.post(`/api/v1/employees/${own.id}/deactivate`).send({});
      expect([res.status, errorBody(res).code]).toEqual([409, 'CANNOT_DISABLE_SELF']);
    });

    it('keeps HR from deactivating an administrator and leaves everything unchanged', async () => {
      const adminEmployee = employeeSchema.parse(
        (await acme.admin.agent.get('/api/v1/employees/me')).body,
      );
      const res = await hr.agent.post(`/api/v1/employees/${adminEmployee.id}/deactivate`).send({});
      expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      const row = await system.employee.findUniqueOrThrow({ where: { id: adminEmployee.id } });
      expect(row.status).toBe('active');
      expect((await acme.admin.agent.get('/api/v1/auth/me')).status).toBe(200);
    });

    it('protects the last administrator when another administrator deactivates them', async () => {
      // A second administrator exists, so the first may go; then the second is the last one.
      const second = await onboard(acme, acme.admin, 'second.admin@acme.eu');
      const promote = await acme.admin.agent
        .put(`/api/v1/users/${second.id}/roles`)
        .send({ roleIds: [acme.roleIds.admin] });
      expect(promote.status).toBe(200);
      const adminEmployee = employeeSchema.parse(
        (await acme.admin.agent.get('/api/v1/employees/me')).body,
      );

      const first = await second.agent
        .post(`/api/v1/employees/${adminEmployee.id}/deactivate`)
        .send({});
      expect(first.status).toBe(200);
      expect((await acme.admin.agent.get('/api/v1/auth/me')).status).toBe(401);

      // Reactivate so the workspace keeps working for later tests.
      const back = await second.agent.post(`/api/v1/employees/${adminEmployee.id}/reactivate`);
      expect(back.status).toBe(200);
    });
  });

  describe('tenant isolation', () => {
    it('hides employees of other workspaces from lists, reads and every write', async () => {
      const foreign = employeeSchema.parse(
        (await create(globex.admin, { ...base, firstName: 'Secret', employeeNo: 'G-1' })).body,
      );

      const list = employeeListSchema.parse(
        (await hr.agent.get('/api/v1/employees?status=all&pageSize=100')).body,
      );
      expect(list.items.some((e) => e.id === foreign.id)).toBe(false);
      expect((await hr.agent.get('/api/v1/employees').query({ q: 'Secret' })).body.total).toBe(0);

      const attempts = [
        hr.agent.get(`/api/v1/employees/${foreign.id}`),
        hr.agent.patch(`/api/v1/employees/${foreign.id}`).send({ jobTitle: 'Hacked' }),
        hr.agent.post(`/api/v1/employees/${foreign.id}/deactivate`).send({}),
        hr.agent.post(`/api/v1/employees/${foreign.id}/reactivate`),
        hr.agent.post(`/api/v1/employees/${foreign.id}/invitation`).send({ email: 'x@acme.eu' }),
      ];
      for (const res of await Promise.all(attempts)) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      const row = await system.employee.findUniqueOrThrow({ where: { id: foreign.id } });
      expect(row).toMatchObject({ status: 'active', jobTitle: null });
    });

    it('lets the database itself refuse cross-workspace reads, inserts and deletes', async () => {
      const mine = await system.employee.findFirstOrThrow({ where: { tenantId: acme.tenantId } });
      // Another workspace's context sees none of acme's rows ...
      expect(
        await asTenant(globex.tenantId, (tx) => tx.employee.findUnique({ where: { id: mine.id } })),
      ).toBeNull();
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.employee.updateMany({ where: { id: mine.id }, data: { jobTitle: 'x' } }),
        ),
      ).toEqual({ count: 0 });
      // ... cannot insert rows for acme ...
      await expect(
        asTenant(globex.tenantId, (tx) =>
          tx.employee.create({ data: { tenantId: acme.tenantId, firstName: 'A', lastName: 'B' } }),
        ),
      ).rejects.toThrow();
      // ... and the application role may never delete employees at all.
      await expect(
        asTenant(acme.tenantId, (tx) => tx.$executeRaw`DELETE FROM employee`),
      ).rejects.toThrow(/permission denied/);
    });

    it('rejects links to a user of another workspace', async () => {
      const foreignUser = await system.user.findFirstOrThrow({
        where: { tenantId: globex.tenantId },
      });
      await expect(
        system.employee.create({
          data: { tenantId: acme.tenantId, userId: foreignUser.id, firstName: 'X', lastName: 'Y' },
        }),
      ).rejects.toThrow();
    });
  });

  describe('database rules', () => {
    it.each([
      ['an unknown status', { status: 'gone' }],
      ['an unknown employment type', { employmentType: 'slave' }],
      ['a lowercase country', { country: 'bg' }],
      ['a blank name', { firstName: '   ' }],
      ['a termination date on an active employee', { terminationDate: new Date('2026-01-01') }],
      [
        'a termination before the hire date',
        {
          status: 'inactive',
          hireDate: new Date('2026-02-01'),
          terminationDate: new Date('2026-01-01'),
        },
      ],
    ])('refuses %s', async (_label, data) => {
      await expect(
        system.employee.create({
          data: { tenantId: acme.tenantId, firstName: 'A', lastName: 'B', ...data },
        }),
      ).rejects.toThrow();
    });
  });
});
