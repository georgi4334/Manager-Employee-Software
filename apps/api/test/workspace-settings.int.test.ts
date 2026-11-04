import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  workspaceSettingsSchema,
  type SystemRole,
  type WorkspaceSettings,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { TenantContext } from '../src/infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../src/infrastructure/tenancy/tenant-db.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const api = '/api/v1';
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;

describe.skipIf(!urls)('workspace settings over HTTP (real database)', () => {
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
  const read = async (as: Member): Promise<WorkspaceSettings> => {
    const res = await as.agent.get(`${api}/settings/workspace`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return workspaceSettingsSchema.parse(res.body);
  };
  const put = (as: Member, body: object) => as.agent.put(`${api}/settings/workspace`).send(body);
  const audits = (tenantId: string) =>
    system.auditLog.findMany({
      where: { tenantId, action: 'workspace.updated' },
      orderBy: { createdAt: 'asc' },
    });

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

  it('lets every member read the basics; only the administrator may edit', async () => {
    const tenant = await system.tenant.findUniqueOrThrow({ where: { id: acme.tenantId } });
    const admin = await read(acme.admin);
    expect(admin).toEqual({
      name: tenant.name,
      slug: tenant.slug,
      timeZone: tenant.defaultTimezone,
      language: tenant.defaultLocale,
      country: null,
      canEdit: true,
    });
    for (const who of [hr, mia, dan]) {
      expect(await read(who)).toEqual({ ...admin, canEdit: false });
    }
  });

  it('the administrator changes name, time zone, language and country; audit has field names only', async () => {
    const res = await put(acme.admin, {
      name: '  Acme Europe  ',
      timeZone: 'Europe/Berlin',
      language: 'de',
      country: 'de',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(workspaceSettingsSchema.parse(res.body)).toMatchObject({
      name: 'Acme Europe',
      timeZone: 'Europe/Berlin',
      language: 'de',
      country: 'DE',
    });
    const tenant = await system.tenant.findUniqueOrThrow({ where: { id: acme.tenantId } });
    expect(tenant).toMatchObject({
      name: 'Acme Europe',
      defaultTimezone: 'Europe/Berlin',
      defaultLocale: 'de',
    });
    // the slug never changes, and the country is the leave settings' own
    expect(tenant.slug).toBe((await read(dan)).slug);
    expect(
      (await system.leaveSettings.findUniqueOrThrow({ where: { tenantId: acme.tenantId } }))
        .defaultCountry,
    ).toBe('DE');
    const leave = await acme.admin.agent.get(`${api}/leave/settings`);
    expect(leave.body).toMatchObject({ defaultCountry: 'DE' });

    const [entry] = await audits(acme.tenantId);
    expect(entry).toMatchObject({
      actorUserId: acme.admin.id,
      entity: 'tenant',
      entityId: acme.tenantId,
      after: { fields: ['name', 'timeZone', 'language', 'country'] },
    });
    expect(JSON.stringify(entry)).not.toMatch(/Acme Europe|Berlin|"de"|DE"/);

    // the new name is what the signed-in user sees
    const me = await dan.agent.get(`${api}/auth/me`);
    expect(me.body.workspace.name).toBe('Acme Europe');
  });

  it('changes only what is different, and writes nothing when nothing changed', async () => {
    const before = (await audits(acme.tenantId)).length;
    expect((await put(acme.admin, { name: 'Acme Europe', language: 'de' })).status).toBe(200);
    expect(await audits(acme.tenantId)).toHaveLength(before);
    expect((await put(acme.admin, { country: null })).status).toBe(200);
    const after = await audits(acme.tenantId);
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)?.after).toEqual({ fields: ['country'] });
    expect((await read(dan)).country).toBeNull();
  });

  it.each([
    ['HR', () => hr],
    ['a manager', () => mia],
    ['an employee', () => dan],
  ])('%s cannot change anything', async (_name, who) => {
    const before = await read(acme.admin);
    const res = await put(who(), { name: 'Hijacked' });
    expect(res.status).toBe(403);
    expect(errorBody(res).code).toBe('FORBIDDEN');
    expect(await read(acme.admin)).toEqual(before);
  });

  it.each([
    [{}],
    [{ name: '' }],
    [{ name: 'x'.repeat(101) }],
    [{ timeZone: 'Mars/Olympus' }],
    [{ timeZone: '+02:00' }],
    [{ language: 'fr' }],
    [{ country: 'BGR' }],
    [{ slug: 'evil' }],
    [{ name: 'A', id: '0192f5a0-0000-7000-8000-00000000000a' }],
  ])('refuses %j', async (body) => {
    const before = await read(acme.admin);
    const res = await put(acme.admin, body);
    expect(res.status).toBe(400);
    expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    expect(await read(acme.admin)).toEqual(before);
  });

  it('never reads or changes another workspace', async () => {
    const globexBefore = await system.tenant.findUniqueOrThrow({ where: { id: globex.tenantId } });
    expect((await put(acme.admin, { name: 'Acme Again' })).status).toBe(200);
    expect(await system.tenant.findUniqueOrThrow({ where: { id: globex.tenantId } })).toEqual(
      globexBefore,
    );
    expect((await read(globex.admin)).name).toBe(globexBefore.name);
    expect(await audits(globex.tenantId)).toHaveLength(0);

    // even code that asked for the other row by id would find and change nothing (RLS)
    const asAcme = <T>(fn: Parameters<TenantDb['tx']>[0]) =>
      app.get(TenantContext).run(acme.tenantId, () => app.get(TenantDb).tx(fn)) as Promise<T>;
    expect(
      await asAcme((tx) => tx.tenant.findUnique({ where: { id: globex.tenantId } })),
    ).toBeNull();
    const changed = await asAcme<{ count: number }>((tx) =>
      tx.tenant.updateMany({ where: { id: globex.tenantId }, data: { name: 'Taken' } }),
    );
    expect(changed.count).toBe(0);
    expect((await system.tenant.findUniqueOrThrow({ where: { id: globex.tenantId } })).name).toBe(
      globexBefore.name,
    );
  });

  it('a new time zone is the workspace "today" from the next request on', async () => {
    expect((await put(acme.admin, { timeZone: 'Pacific/Kiritimati' })).status).toBe(200);
    expect((await read(dan)).timeZone).toBe('Pacific/Kiritimati');
    expect(
      (await system.tenant.findUniqueOrThrow({ where: { id: acme.tenantId } })).defaultTimezone,
    ).toBe('Pacific/Kiritimati');
  });
});
