import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  MAX_AMOUNT_MINOR,
  MAX_COMPENSATION_ROWS,
  addDays,
  apiErrorBodySchema,
  compensationSchema,
  employeeSchema,
  personalDataExportSchema,
  todayIn,
  type SystemRole,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;
const UNKNOWN = '0192f5a0-0000-7000-8000-00000000000a';
const ZONE = 'Europe/Sofia';
const api = '/api/v1';
/** Easy to find in a dump: it must never appear in the audit log or the outbox. */
const SECRET = 8_765_432;

describe.skipIf(!urls)('compensation over HTTP (real database)', () => {
  const env = testEnv({
    DATABASE_URL: urls?.app,
    SYSTEM_DATABASE_URL: urls?.system,
    TRUST_PROXY: 'true',
  });
  let app: NestExpressApplication;
  let system: SystemPrismaService;
  const { workspace, accept } = httpWorkspaceHelpers(() => app);

  type Person = Member & { employeeId: string };
  let acme: Workspace;
  let globex: Workspace;
  let hr: Person;
  let hr2: Person;
  let mia: Person; // manager of dan
  let dan: Person;
  let eve: Person;
  let adminEmployeeId: string;
  let globexHr: Person;
  let globexEmployee: Person;

  const today = todayIn(ZONE);
  const day = (n: number) => addDays(today, n);

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
    return { ...who, employeeId: employeeSchema.parse(res.body).id };
  }
  const url = (who: { employeeId: string }, tail = '') =>
    `${api}/employees/${who.employeeId}/compensation${tail}`;
  const get = async (as: Member, who: { employeeId: string }) => {
    const res = await as.agent.get(url(who));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return compensationSchema.parse(res.body);
  };
  const put = (as: Member, who: { employeeId: string }, body: object) =>
    as.agent.put(url(who)).send(body);
  const pay = (over: object = {}) => ({
    validFrom: day(-30),
    basis: 'monthly',
    amountMinor: 350_000,
    currency: 'EUR',
    ...over,
  });
  const clear = (who: { employeeId: string }) =>
    system.compensation.deleteMany({ where: { employeeId: who.employeeId } });

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    await system.tenant.update({ where: { id: acme.tenantId }, data: { defaultTimezone: ZONE } });
    hr = await onboard(acme, 'hrx', 'hr');
    hr2 = await onboard(acme, 'hry', 'hr');
    mia = await onboard(acme, 'mia', 'manager');
    dan = await onboard(acme, 'dan');
    eve = await onboard(acme, 'eve');
    const assign = await acme.admin.agent
      .put(`${api}/org/employees/${dan.employeeId}/assignment`)
      .send({ managerId: mia.employeeId, departmentId: null });
    expect(assign.status).toBe(204);
    const admin = await system.employee.findFirstOrThrow({ where: { userId: acme.admin.id } });
    adminEmployeeId = admin.id;
    globexHr = await onboard(globex, 'ghr', 'hr');
    globexEmployee = await onboard(globex, 'gina');
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  describe('who can read', () => {
    it('is readable by HR and administrators, and empty until something is set', async () => {
      for (const who of [hr, acme.admin as Member]) {
        const c = await get(who, dan);
        expect(c).toMatchObject({ employeeId: dan.employeeId, items: [], canManage: true });
      }
    });

    it.each([
      ['the person themselves', () => dan],
      ['their manager', () => mia],
      ['a colleague', () => eve],
    ])('is refused to %s', async (_name, who) => {
      const res = await who().agent.get(url(dan));
      expect(res.status).toBe(403);
      expect(errorBody(res).code).toBe('FORBIDDEN');
    });

    it('is 404 for an unknown person and another workspace, 400 for a bad id, 401 signed out', async () => {
      expect((await hr.agent.get(`${api}/employees/${UNKNOWN}/compensation`)).status).toBe(404);
      expect((await globexHr.agent.get(url(dan))).status).toBe(404);
      expect((await hr.agent.get(url(globexEmployee))).status).toBe(404);
      expect((await hr.agent.get(`${api}/employees/nope/compensation`)).status).toBe(400);
      const anon = await (await import('supertest')).default(app.getHttpServer()).get(url(dan));
      expect(anon.status).toBe(401);
    });

    it('is never cached, and never part of the employee record', async () => {
      await put(hr, dan, pay({ amountMinor: SECRET }));
      const res = await hr.agent.get(url(dan));
      expect(res.headers['cache-control']).toBe('no-store');
      const profile = await acme.admin.agent.get(`${api}/employees/${dan.employeeId}`);
      expect(JSON.stringify(profile.body)).not.toContain(String(SECRET));
      const asDan = await dan.agent.get(`${api}/employees/${dan.employeeId}`);
      expect(JSON.stringify(asDan.body)).not.toContain(String(SECRET));
      await clear(dan);
    });
  });

  describe('changing', () => {
    it('is for HR and administrators only', async () => {
      for (const who of [dan, mia, eve]) {
        const res = await put(who, dan, pay());
        expect(res.status).toBe(403);
      }
      expect((await dan.agent.delete(url(dan, `/${UNKNOWN}`))).status).toBe(403);
      expect(await system.compensation.count({ where: { employeeId: dan.employeeId } })).toBe(0);
    });

    it('stores a record and marks the one in force today', async () => {
      const res = await put(hr, dan, pay());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const c = compensationSchema.parse(res.body);
      expect(c.items).toHaveLength(1);
      expect(c.items[0]).toMatchObject({
        validFrom: day(-30),
        basis: 'monthly',
        amountMinor: 350_000,
        currency: 'EUR',
        current: true,
      });
    });

    it('keeps history: a later row is in force from its date, an earlier one stays', async () => {
      await put(hr, dan, pay({ validFrom: day(10), amountMinor: 400_000 }));
      await put(hr, dan, pay({ validFrom: day(-400), amountMinor: 300_000 }));
      const c = await get(hr, dan);
      expect(c.items.map((i) => [i.validFrom, i.amountMinor, i.current])).toEqual([
        [day(10), 400_000, false],
        [day(-30), 350_000, true],
        [day(-400), 300_000, false],
      ]);
    });

    it('replaces the record of the same date instead of adding one', async () => {
      await put(hr, dan, pay({ amountMinor: 360_000, basis: 'yearly', currency: 'BGN' }));
      const c = await get(hr, dan);
      expect(c.items).toHaveLength(3);
      expect(c.items.find((i) => i.validFrom === day(-30))).toMatchObject({
        amountMinor: 360_000,
        basis: 'yearly',
        currency: 'BGN',
      });
    });

    it('defaults the currency to EUR and keeps the largest amount exactly', async () => {
      const { currency: _currency, ...noCurrency } = pay({
        validFrom: day(-900),
        basis: 'hourly',
        amountMinor: MAX_AMOUNT_MINOR,
      });
      const res = await put(hr, dan, noCurrency);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const row = (await get(hr, dan)).items.find((i) => i.validFrom === day(-900))!;
      expect(row).toMatchObject({
        currency: 'EUR',
        basis: 'hourly',
        amountMinor: MAX_AMOUNT_MINOR,
      });
    });

    it.each([
      ['an unknown basis', { basis: 'weekly' }],
      ['a zero amount', { amountMinor: 0 }],
      ['a negative amount', { amountMinor: -100 }],
      ['a fraction of a cent', { amountMinor: 10.5 }],
      ['an amount over the limit', { amountMinor: MAX_AMOUNT_MINOR + 1 }],
      ['a text amount', { amountMinor: '100' }],
      ['an unknown currency', { currency: 'XXX' }],
      ['a bad date', { validFrom: '1.1.2026' }],
      ['a note', { note: 'bonus' }],
    ])('refuses %s', async (_name, patch) => {
      const res = await put(hr, eve, pay(patch));
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
      expect(await system.compensation.count({ where: { employeeId: eve.employeeId } })).toBe(0);
    });

    it('is 404 for an unknown person and another workspace', async () => {
      expect((await put(hr, { employeeId: UNKNOWN }, pay())).status).toBe(404);
      expect((await put(hr, globexEmployee, pay())).status).toBe(404);
      expect((await put(globexHr, dan, pay())).status).toBe(404);
    });

    it('allows only a limited number of records per person', async () => {
      await clear(eve);
      for (let i = 0; i < MAX_COMPENSATION_ROWS; i++) {
        await system.compensation.create({
          data: {
            tenantId: acme.tenantId,
            employeeId: eve.employeeId,
            validFrom: new Date(addDays('2020-01-01', i) + 'T00:00:00Z'),
            basis: 'monthly',
            amountMinor: BigInt(100_000),
          },
        });
      }
      const res = await put(hr, eve, pay());
      expect(res.status).toBe(409);
      expect(errorBody(res).params).toMatchObject({ field: 'limit' });
      // changing an existing date is still fine
      expect((await put(hr, eve, pay({ validFrom: '2020-01-01' }))).status).toBe(200);
      await clear(eve);
    });

    it('removes one record, and refuses ids of other people or unknown rows', async () => {
      const c = await get(hr, dan);
      const oldest = c.items.at(-1)!;
      const del = await hr.agent.delete(url(dan, `/${oldest.id}`));
      expect(del.status).toBe(200);
      expect(compensationSchema.parse(del.body).items.map((i) => i.id)).not.toContain(oldest.id);
      expect((await hr.agent.delete(url(dan, `/${oldest.id}`))).status).toBe(404);
      expect((await hr.agent.delete(url(dan, `/${UNKNOWN}`))).status).toBe(404);
      // a row of Dan's, asked for through Eve
      const mine = c.items[0]!;
      expect((await hr.agent.delete(url(eve, `/${mine.id}`))).status).toBe(404);
      expect(await system.compensation.count({ where: { id: mine.id } })).toBe(1);
    });
  });

  describe('nobody changes their own pay', () => {
    it('refuses HR and administrators for themselves, and lets another one do it', async () => {
      const hrSelf = { employeeId: hr.employeeId };
      const adminSelf = { employeeId: adminEmployeeId };
      for (const [who, self] of [
        [hr, hrSelf],
        [acme.admin as Member, adminSelf],
      ] as const) {
        const res = await put(who, self, pay());
        expect(res.status).toBe(403);
        expect(errorBody(res).code).toBe('FORBIDDEN');
        expect((await who.agent.delete(url(self, `/${UNKNOWN}`))).status).toBe(403);
      }
      expect(await system.compensation.count({ where: { employeeId: hr.employeeId } })).toBe(0);
      expect((await put(hr2, hrSelf, pay())).status).toBe(200);
      expect((await put(acme.admin as Member, hrSelf, pay({ amountMinor: 1 }))).status).toBe(200);
      // reading their own record is allowed to the roles that hold the permission
      expect((await get(hr, hrSelf)).items).toHaveLength(1);
    });
  });

  describe('audit and notifications', () => {
    it('records ids, date, basis and currency, never an amount', async () => {
      await put(hr, eve, pay({ amountMinor: SECRET, basis: 'hourly', currency: 'GBP' }));
      const rows = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: { startsWith: 'compensation.' } },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.length).toBeGreaterThan(0);
      const set = rows
        .filter((r) => (r.after as { employeeId?: string } | null)?.employeeId === eve.employeeId)
        .at(-1)!;
      expect(set.after).toEqual({
        employeeId: eve.employeeId,
        validFrom: day(-30),
        basis: 'hourly',
        currency: 'GBP',
      });
      const dump = JSON.stringify([
        rows,
        await system.outboxEvent.findMany({ where: { tenantId: acme.tenantId } }),
        await system.notification.findMany({ where: { tenantId: acme.tenantId } }),
      ]);
      expect(dump).not.toContain(String(SECRET));
      const note = await system.outboxEvent.count({
        where: { tenantId: acme.tenantId, type: { contains: 'compensation' } },
      });
      expect(note).toBe(0);
      await clear(eve);
    });

    it('audits a removal with the date only', async () => {
      await put(hr, eve, pay({ amountMinor: SECRET }));
      const row = (await get(hr, eve)).items[0]!;
      await hr.agent.delete(url(eve, `/${row.id}`));
      const removed = await system.auditLog.findFirstOrThrow({
        where: { tenantId: acme.tenantId, action: 'compensation.removed', entityId: row.id },
      });
      expect(removed.after).toEqual({ employeeId: eve.employeeId, validFrom: day(-30) });
    });
  });

  describe('personal data', () => {
    it('is in the own export of the person and in the HR export, and stays after deactivation', async () => {
      await clear(dan);
      await put(hr, dan, pay({ amountMinor: 123_456, currency: 'CHF' }));
      const own = personalDataExportSchema.parse(
        (await dan.agent.get(`${api}/privacy/export`)).body,
      );
      expect(own.compensation).toEqual([
        { validFrom: day(-30), basis: 'monthly', amountMinor: 123_456, currency: 'CHF' },
      ]);
      const viaHr = personalDataExportSchema.parse(
        (await hr.agent.get(`${api}/privacy/export/${dan.employeeId}`)).body,
      );
      expect(viaHr.compensation).toHaveLength(1);
      // colleagues' exports never contain it
      const evesOwn = personalDataExportSchema.parse(
        (await eve.agent.get(`${api}/privacy/export`)).body,
      );
      expect(evesOwn.compensation).toEqual([]);
    });

    it('is left out of an HR export by somebody who may export people but not see pay', async () => {
      await clear(dan);
      await put(hr, dan, pay({ amountMinor: SECRET }));
      const exporter = await onboard(acme, 'exporter');
      const role = await system.role.create({
        data: {
          tenantId: acme.tenantId,
          name: 'Privacy officer',
          permissions: { create: [{ permissionCode: 'gdpr.export_employee', scope: 'all' }] },
        },
      });
      const granted = await acme.admin.agent
        .put(`${api}/users/${exporter.id}/roles`)
        .send({ roleIds: [role.id] });
      expect(granted.status, JSON.stringify(granted.body)).toBe(200);
      const res = await exporter.agent.get(`${api}/privacy/export/${dan.employeeId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(personalDataExportSchema.parse(res.body).compensation).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain(String(SECRET));
      await clear(dan);
    });

    it('is deleted by the erasure of a former employee', async () => {
      const gone = await onboard(acme, 'gone');
      await put(hr, gone, pay());
      expect(await system.compensation.count({ where: { employeeId: gone.employeeId } })).toBe(1);
      const off = await acme.admin.agent
        .post(`${api}/employees/${gone.employeeId}/deactivate`)
        .send({});
      expect(off.status, JSON.stringify(off.body)).toBeLessThan(300);
      expect(await system.compensation.count({ where: { employeeId: gone.employeeId } })).toBe(1);
      const erased = await hr.agent
        .post(`${api}/privacy/erase/${gone.employeeId}`)
        .send({ confirm: true });
      expect(erased.status, JSON.stringify(erased.body)).toBeLessThan(300);
      expect(await system.compensation.count({ where: { employeeId: gone.employeeId } })).toBe(0);
    });
  });

  describe('workspaces and the database', () => {
    it('keeps each workspace to its own rows', async () => {
      await put(globexHr, globexEmployee, pay({ amountMinor: 222_222 }));
      const theirs = await system.compensation.findMany({
        where: { employeeId: globexEmployee.employeeId },
      });
      expect(theirs).toHaveLength(1);
      expect(theirs[0]?.tenantId).toBe(globex.tenantId);
      expect((await get(globexHr, globexEmployee)).items).toHaveLength(1);
      // the other workspace sees nothing, not even an empty list
      expect((await hr.agent.get(url(globexEmployee))).status).toBe(404);
      // a row cannot point at an employee of another workspace
      await expect(
        system.compensation.create({
          data: {
            tenantId: acme.tenantId,
            employeeId: globexEmployee.employeeId,
            validFrom: new Date('2026-01-01T00:00:00Z'),
            basis: 'monthly',
            amountMinor: BigInt(100),
          },
        }),
      ).rejects.toThrow();
    });

    it.each([
      ['an unknown basis', { basis: 'weekly' }],
      ['a zero amount', { amountMinor: BigInt(0) }],
      ['an amount over the limit', { amountMinor: BigInt(MAX_AMOUNT_MINOR) + BigInt(1) }],
      ['an unknown currency', { currency: 'XXX' }],
    ])('refuses %s in the database too', async (_name, patch) => {
      await expect(
        system.compensation.create({
          data: {
            tenantId: acme.tenantId,
            employeeId: eve.employeeId,
            validFrom: new Date('2026-01-01T00:00:00Z'),
            basis: 'monthly',
            amountMinor: BigInt(100),
            ...patch,
          },
        }),
      ).rejects.toThrow();
    });

    it('does not allow two rows for one person and date', async () => {
      const row = {
        tenantId: acme.tenantId,
        employeeId: eve.employeeId,
        validFrom: new Date('2026-02-01T00:00:00Z'),
        basis: 'monthly',
        amountMinor: BigInt(100),
      };
      await system.compensation.create({ data: row });
      await expect(system.compensation.create({ data: row })).rejects.toThrow();
      await clear(eve);
    });
  });
});
