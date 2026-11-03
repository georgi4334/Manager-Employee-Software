import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  auditPageSchema,
  type AuditPage,
  type SystemRole,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const api = '/api/v1';
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;

describe.skipIf(!urls)('audit log viewer over HTTP (real database)', () => {
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
  let mia: Member;
  let dan: Member;
  let danEmployeeId: string;

  async function onboard(ws: Workspace, name: string, role: SystemRole = 'employee') {
    const email = `${name}@${ws === acme ? 'acme' : 'globex'}.eu`;
    const res = await ws.admin.agent
      .post(`${api}/employees`)
      .send({ firstName: name, lastName: 'Test', employmentType: 'full_time', email });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const who = await accept(email);
    if (role !== 'employee') {
      const set = await ws.admin.agent
        .put(`${api}/users/${who.id}/roles`)
        .send({ roleIds: [ws.roleIds[role]] });
      expect(set.status).toBe(200);
    }
    return { who, employeeId: (res.body as { id: string }).id };
  }
  const list = async (as: Member, query: Record<string, string> = {}) => {
    const res = await as.agent.get(`${api}/audit-log`).query(query);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    return auditPageSchema.parse(res.body) satisfies AuditPage;
  };
  const actions = (page: AuditPage) => page.items.map((i) => i.action);

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    hr = (await onboard(acme, 'hrx', 'hr')).who;
    mia = (await onboard(acme, 'mia', 'manager')).who;
    const d = await onboard(acme, 'dan');
    dan = d.who;
    danEmployeeId = d.employeeId;
    // a workspace setting (Admin only) and something in the other workspace
    expect(
      (await acme.admin.agent.put(`${api}/dashboard/layout`).send({ widgets: ['tasks'] })).status,
    ).toBe(200);
    await onboard(globex, 'gus');
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  it('shows the administrator every area, newest first, with names looked up now', async () => {
    const page = await list(acme.admin);
    expect(page.areas).toContain('workspace');
    expect(page.items[0]!.action).toBe('dashboard.updated');
    expect(actions(page)).toEqual(
      expect.arrayContaining(['employee.created', 'user.roles_changed']),
    );
    const created = page.items.find(
      (i) => i.action === 'employee.created' && i.entityId === danEmployeeId,
    )!;
    expect(created).toMatchObject({
      area: 'people',
      entity: 'employee',
      actor: { userId: acme.admin.id },
      subject: { name: 'dan Test' },
    });
    const times = page.items.map((i) => i.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('shows HR the HR-related areas only, never the workspace settings', async () => {
    const page = await list(hr);
    expect(page.areas).not.toContain('workspace');
    expect(page.areas).toEqual(expect.arrayContaining(['people', 'compensation', 'privacy']));
    expect(actions(page)).toContain('employee.created');
    expect(actions(page)).not.toContain('dashboard.updated');
    const asked = await hr.agent.get(`${api}/audit-log`).query({ area: 'workspace' });
    expect(asked.status).toBe(403);
    expect(errorBody(asked).code).toBe('FORBIDDEN');
  });

  it.each([
    ['a manager', () => mia],
    ['an employee', () => dan],
  ])('refuses %s', async (_name, who) => {
    const res = await who().agent.get(`${api}/audit-log`);
    expect(res.status).toBe(403);
    expect(errorBody(res).code).toBe('FORBIDDEN');
  });

  it('never shows another workspace', async () => {
    const acmeIds = new Set((await list(acme.admin, { pageSize: '100' })).items.map((i) => i.id));
    const globexPage = await list(globex.admin, { pageSize: '100' });
    expect(globexPage.items.length).toBeGreaterThan(0);
    for (const item of globexPage.items) expect(acmeIds.has(item.id)).toBe(false);
    // another workspace's record id finds nothing here
    const gusEntry = globexPage.items.find((i) => i.action === 'employee.created')!;
    expect((await list(acme.admin, { entityId: gusEntry.entityId! })).total).toBe(0);
  });

  it('filters by area, record, person and day', async () => {
    const people = await list(acme.admin, { area: 'people' });
    expect(new Set(people.items.map((i) => i.area))).toEqual(new Set(['people']));
    const history = await list(acme.admin, { entityId: danEmployeeId });
    expect(history.items.length).toBeGreaterThan(0);
    for (const item of history.items) expect(item.entityId).toBe(danEmployeeId);
    const mine = await list(acme.admin, { actorUserId: acme.admin.id });
    for (const item of mine.items) expect(item.actor.userId).toBe(acme.admin.id);
    expect((await list(acme.admin, { actorUserId: dan.id })).total).toBe(0);

    await system.auditLog.create({
      data: {
        tenantId: acme.tenantId,
        actorUserId: null,
        action: 'leave.settings_updated',
        entity: 'leave_settings',
        createdAt: new Date('2025-03-10T12:00:00Z'),
      },
    });
    const day = await list(acme.admin, { from: '2025-03-10', to: '2025-03-10' });
    expect(actions(day)).toEqual(['leave.settings_updated']);
    expect(day.items[0]!.actor).toEqual({ userId: null, name: null, employeeId: null });
    expect((await list(acme.admin, { from: '2025-03-11', to: '2025-03-12' })).total).toBe(0);
    expect((await list(acme.admin, { to: '2025-03-09' })).total).toBe(0);
  });

  it('pages through the entries', async () => {
    const all = await list(acme.admin, { pageSize: '100' });
    const first = await list(acme.admin, { pageSize: '2' });
    const second = await list(acme.admin, { pageSize: '2', page: '2' });
    expect(first.total).toBe(all.total);
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual(
      all.items.slice(0, 4).map((i) => i.id),
    );
  });

  it('never shows entries outside the catalog', async () => {
    await system.auditLog.create({
      data: { tenantId: acme.tenantId, actorUserId: null, action: 'legacy.thing', entity: 'x' },
    });
    const all = await list(acme.admin, { pageSize: '100' });
    expect(actions(all)).not.toContain('legacy.thing');
  });

  it('shows no name for an erased person', async () => {
    const created = await acme.admin.agent
      .post(`${api}/employees`)
      .send({ firstName: 'Eve', lastName: 'Gone', employmentType: 'full_time' });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    await system.employee.update({ where: { id }, data: { erasedAt: new Date() } });
    const [entry] = (await list(acme.admin, { entityId: id })).items;
    expect(entry?.subject).toEqual({ name: null });
  });

  it.each([
    [{ area: 'payroll' }],
    [{ from: '2026-11-05', to: '2026-11-01' }],
    [{ entityId: 'nope' }],
    [{ pageSize: '500' }],
  ])('refuses the query %j', async (query) => {
    const res = await acme.admin.agent.get(`${api}/audit-log`).query(query);
    expect(res.status).toBe(400);
    expect(errorBody(res).code).toBe('VALIDATION_FAILED');
  });
});
