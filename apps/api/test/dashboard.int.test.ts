import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  DEFAULT_DASHBOARD,
  apiErrorBodySchema,
  dashboardLayoutSchema,
  type DashboardLayout,
  type SystemRole,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { TenantContext, type TenantTx } from '../src/infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../src/infrastructure/tenancy/tenant-db.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const api = '/api/v1';
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;

describe.skipIf(!urls)('dashboard layout over HTTP (real database)', () => {
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

  async function onboard(ws: Workspace, name: string, role: SystemRole = 'employee') {
    const email = `${name}@acme.eu`;
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
    return who;
  }
  const read = async (as: Member) => {
    const res = await as.agent.get(`${api}/dashboard/layout`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return dashboardLayoutSchema.parse(res.body) satisfies DashboardLayout;
  };
  const asTenant = <T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>) =>
    app.get(TenantContext).run(tenantId, () => app.get(TenantDb).tx(fn));
  const put = (as: Member, widgets: unknown) =>
    as.agent.put(`${api}/dashboard/layout`).send({ widgets });

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    hr = await onboard(acme, 'hrx', 'hr');
    mia = await onboard(acme, 'mia', 'manager');
    dan = await onboard(acme, 'dan');
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  it('starts with the default layout for everybody; only the administrator may edit', async () => {
    const admin = await read(acme.admin);
    expect(admin).toEqual({ widgets: [...DEFAULT_DASHBOARD], isDefault: true, canEdit: true });
    for (const who of [hr, mia, dan]) {
      expect(await read(who)).toEqual({
        widgets: [...DEFAULT_DASHBOARD],
        isDefault: true,
        canEdit: false,
      });
    }
  });

  it('the administrator sets widgets and order; everybody sees the same layout', async () => {
    const res = await put(acme.admin, ['tasks', 'stat_hours', 'analytics']);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(dashboardLayoutSchema.parse(res.body)).toEqual({
      widgets: ['tasks', 'stat_hours', 'analytics'],
      isDefault: false,
      canEdit: true,
    });
    expect((await read(dan)).widgets).toEqual(['tasks', 'stat_hours', 'analytics']);
    const again = await put(acme.admin, ['analytics', 'tasks']);
    expect(again.status).toBe(200);
    expect((await read(mia)).widgets).toEqual(['analytics', 'tasks']);
    expect(await system.dashboardLayout.count({ where: { tenantId: acme.tenantId } })).toBe(1);
  });

  it('an empty dashboard is allowed', async () => {
    expect((await put(acme.admin, [])).status).toBe(200);
    expect(await read(dan)).toMatchObject({ widgets: [], isDefault: false });
  });

  it.each([
    ['HR', () => hr],
    ['a manager', () => mia],
    ['an employee', () => dan],
  ])('%s cannot change or reset it', async (_name, who) => {
    const before = await read(acme.admin);
    const change = await put(who(), ['roles']);
    expect(change.status).toBe(403);
    expect(errorBody(change).code).toBe('FORBIDDEN');
    expect((await who().agent.delete(`${api}/dashboard/layout`)).status).toBe(403);
    expect(await read(acme.admin)).toEqual(before);
  });

  it.each([
    ['an unknown widget', ['tasks', 'payroll']],
    ['a widget twice', ['tasks', 'tasks']],
    ['not a list', 'tasks'],
    ['a number', [1]],
  ])('refuses %s', async (_name, widgets) => {
    const res = await put(acme.admin, widgets);
    expect(res.status).toBe(400);
    expect(errorBody(res).code).toBe('VALIDATION_FAILED');
  });

  it('is refused without a session', async () => {
    const res = await (
      await import('supertest')
    )
      .default(app.getHttpServer())
      .get(`${api}/dashboard/layout`);
    expect(res.status).toBe(401);
  });

  it('drops widgets that left the catalog when reading', async () => {
    await system.dashboardLayout.update({
      where: { tenantId: acme.tenantId },
      data: { widgets: ['retired_widget', 'tasks', 'tasks'] },
    });
    expect((await read(dan)).widgets).toEqual(['tasks']);
  });

  it('the database caps the size', async () => {
    await expect(
      system.dashboardLayout.update({
        where: { tenantId: acme.tenantId },
        data: { widgets: Array.from({ length: 51 }, (_, i) => `w${i}`) },
      }),
    ).rejects.toThrow();
  });

  it('changes are audited with the widget ids and reset goes back to the default', async () => {
    expect((await put(acme.admin, ['roles', 'employees'])).status).toBe(200);
    const updated = await system.auditLog.findFirst({
      where: { tenantId: acme.tenantId, action: 'dashboard.updated' },
      orderBy: { createdAt: 'desc' },
    });
    expect(updated?.after).toEqual({ widgets: ['roles', 'employees'] });
    expect(updated?.actorUserId).toBe(acme.admin.id);

    const reset = await acme.admin.agent.delete(`${api}/dashboard/layout`);
    expect(reset.status).toBe(200);
    expect(dashboardLayoutSchema.parse(reset.body)).toMatchObject({
      widgets: [...DEFAULT_DASHBOARD],
      isDefault: true,
    });
    expect(
      await system.auditLog.count({
        where: { tenantId: acme.tenantId, action: 'dashboard.reset' },
      }),
    ).toBe(1);
    // resetting the default again is not an event
    expect((await acme.admin.agent.delete(`${api}/dashboard/layout`)).status).toBe(200);
    expect(
      await system.auditLog.count({
        where: { tenantId: acme.tenantId, action: 'dashboard.reset' },
      }),
    ).toBe(1);
  });

  describe('tenant isolation', () => {
    it('a layout in one workspace never shows or changes in another', async () => {
      expect((await put(acme.admin, ['analytics'])).status).toBe(200);
      expect(await read(globex.admin)).toMatchObject({
        widgets: [...DEFAULT_DASHBOARD],
        isDefault: true,
      });
      expect((await put(globex.admin, ['roles'])).status).toBe(200);
      expect((await read(dan)).widgets).toEqual(['analytics']);
      expect((await globex.admin.agent.delete(`${api}/dashboard/layout`)).status).toBe(200);
      expect((await read(dan)).widgets).toEqual(['analytics']);
    });

    it('row level security hides and protects the other workspace', async () => {
      const acmeRow = await system.dashboardLayout.findUniqueOrThrow({
        where: { tenantId: acme.tenantId },
      });
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.dashboardLayout.findUnique({ where: { id: acmeRow.id } }),
        ),
      ).toBeNull();
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.dashboardLayout.updateMany({ where: { id: acmeRow.id }, data: { widgets: [] } }),
        ),
      ).toEqual({ count: 0 });
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.dashboardLayout.deleteMany({ where: { id: acmeRow.id } }),
        ),
      ).toEqual({ count: 0 });
      await expect(
        asTenant(globex.tenantId, (tx) =>
          tx.dashboardLayout.create({ data: { tenantId: acme.tenantId, widgets: ['roles'] } }),
        ),
      ).rejects.toThrow();
      expect((await read(dan)).widgets).toEqual(['analytics']);
    });
  });
});
