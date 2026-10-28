import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  employeeSchema,
  leaveBalancesSchema,
  leavePreviewSchema,
  leaveRequestListSchema,
  leaveRequestSchema,
  leaveTypeSchema,
  proratedAllowance,
  todayIn,
  weekday,
  type SystemRole,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { TenantContext, type TenantTx } from '../src/infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../src/infrastructure/tenancy/tenant-db.service.js';
import { OutboxWorker } from '../src/modules/notifications/delivery/outbox-worker.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;
const UNKNOWN = '0192f5a0-0000-7000-8000-00000000000a';

describe.skipIf(!urls)('leave over HTTP (real database)', () => {
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
  let mia: Person; // manager
  let dan: Person; // employee, reports to mia
  let eve: Person; // employee, reports to dan
  let gus: Person; // employee, no manager
  let adminEmployeeId: string;
  let annual: string;
  let sick: string;
  let unpaid: string;

  // ----- dates -------------------------------------------------------------------------------
  const today = todayIn('Europe/Sofia');
  const thisYear = Number(today.slice(0, 4));
  /** Almost all tests request leave in this year (always in the future, always inside the 2-year horizon). */
  const testYear = thisYear + 1;
  const firstMonday = (() => {
    let d = `${testYear}-01-10`;
    while (weekday(d) !== 1) d = addDays(d, 1);
    return d;
  })();
  /** The Monday `n` weeks after the first Monday of the test year (n < 46 stays inside the year). */
  const monday = (n: number): string => addDays(firstMonday, 7 * n);
  const week = (n: number) => ({ startDate: monday(n), endDate: addDays(monday(n), 4) });
  /** Every person walks through their own weeks, so their requests never collide with each other. */
  const nextWeekOf = new Map<string, number>();
  const freshWeek = (who?: { id: string }) => {
    const key = who?.id ?? 'shared';
    const n = nextWeekOf.get(key) ?? 0;
    nextWeekOf.set(key, n + 1);
    return week(n);
  };
  /** Reserve `count` consecutive weeks for a person. */
  const reserve = (who: { id: string }, count: number) => {
    const key = who.id;
    const n = nextWeekOf.get(key) ?? 0;
    nextWeekOf.set(key, n + count);
    return n;
  };

  let uniq = 0;
  const asTenant = <T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>) =>
    app.get(TenantContext).run(tenantId, () => app.get(TenantDb).tx(fn));

  async function onboard(
    ws: Workspace,
    name: string,
    role: SystemRole = 'employee',
    extra: object = {},
  ): Promise<Person> {
    const email = `${name}@${ws === acme ? 'acme' : 'globex'}.eu`;
    const res = await ws.admin.agent
      .post('/api/v1/employees')
      .send({ firstName: name, lastName: 'Test', employmentType: 'full_time', email, ...extra });
    expect(res.status).toBe(201);
    const who = await accept(email);
    if (role !== 'employee') {
      const set = await ws.admin.agent
        .put(`/api/v1/users/${who.id}/roles`)
        .send({ roleIds: [ws.roleIds[role]] });
      expect(set.status).toBe(200);
    }
    return { ...who, employeeId: employeeSchema.parse(res.body).id };
  }
  const manage = (ws: Workspace, employeeId: string, managerId: string | null) =>
    ws.admin.agent
      .put(`/api/v1/org/employees/${employeeId}/assignment`)
      .send({ managerId, departmentId: null });

  const body = (typeId: string, w: { startDate: string; endDate: string }, extra: object = {}) => ({
    leaveTypeId: typeId,
    ...w,
    ...extra,
  });
  const request = (
    who: Member,
    typeId: string,
    w: { startDate: string; endDate: string },
    extra: object = {},
  ) => who.agent.post('/api/v1/leave/requests').send(body(typeId, w, extra));
  const decide = (
    who: Member,
    id: string,
    what: 'approve' | 'reject' | 'cancel',
    comment?: string,
  ) => who.agent.post(`/api/v1/leave/requests/${id}/${what}`).send(comment ? { comment } : {});
  const balance = async (who: Member, employeeId?: string, year?: number) => {
    const res = await who.agent
      .get('/api/v1/leave/balances')
      .query({ ...(employeeId ? { employeeId } : {}), ...(year ? { year } : {}) });
    return res;
  };
  const annualFigures = async (who: Member, employeeId?: string, year = testYear) => {
    const res = await balance(who, employeeId, year);
    expect(res.status).toBe(200);
    return leaveBalancesSchema.parse(res.body).balances.find((b) => b.leaveTypeId === annual)!;
  };
  const notificationsOf = async (who: Member) => {
    await app.get(OutboxWorker).runOnce();
    const res = await who.agent.get('/api/v1/notifications');
    expect(res.status).toBe(200);
    return res.body.items as { type: string; params: Record<string, unknown> }[];
  };

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    hr = await onboard(acme, 'hrx', 'hr');
    mia = await onboard(acme, 'mia', 'manager');
    dan = await onboard(acme, 'dan');
    eve = await onboard(acme, 'eve');
    gus = await onboard(acme, 'gus');
    adminEmployeeId = employeeSchema.parse(
      (await acme.admin.agent.get('/api/v1/employees/me')).body,
    ).id;
    for (const [who, manager] of [
      [mia, adminEmployeeId],
      [hr, adminEmployeeId],
      [dan, mia.employeeId],
      [eve, dan.employeeId],
    ] as const) {
      expect((await manage(acme, who.employeeId, manager)).status).toBe(204);
    }
    const types = (await dan.agent.get('/api/v1/leave/types')).body as {
      id: string;
      key: string;
    }[];
    annual = types.find((t) => t.key === 'annual')!.id;
    sick = types.find((t) => t.key === 'sick')!.id;
    unpaid = types.find((t) => t.key === 'unpaid')!.id;
    // The shared people file many requests; give them plenty of days so only the balance tests run dry.
    for (const who of [hr, mia, dan, eve, gus]) {
      const res = await hr.agent.post('/api/v1/leave/balances/adjustments').send({
        employeeId: who.employeeId,
        leaveTypeId: annual,
        year: testYear,
        delta: 60,
      });
      expect(res.status).toBe(201);
    }
    const adminAdjust = await hr.agent.post('/api/v1/leave/balances/adjustments').send({
      employeeId: adminEmployeeId,
      leaveTypeId: annual,
      year: testYear,
      delta: 60,
    });
    expect(adminAdjust.status).toBe(201);
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe('types, policies and settings', () => {
    it('gives every new workspace the four system types and a 20 day annual policy', async () => {
      const res = await hr.agent.get('/api/v1/leave/types');
      const types = (res.body as unknown[]).map((t) => leaveTypeSchema.parse(t));
      expect(types.map((t) => t.key).sort()).toEqual(['annual', 'parental', 'sick', 'unpaid']);
      const a = types.find((t) => t.key === 'annual')!;
      expect(a).toMatchObject({
        tracksBalance: true,
        requiresApproval: true,
        allowanceDays: 20,
        carryOverMaxDays: 5,
      });
      expect(types.find((t) => t.key === 'sick')).toMatchObject({
        isSick: true,
        requiresApproval: false,
        tracksBalance: false,
      });
    });

    it('lets HR add custom types and refuses duplicates, bad colours and sick types with a balance', async () => {
      const create = (b: object) => hr.agent.post('/api/v1/leave/types').send(b);
      const ok = await create({
        name: 'Study leave',
        tracksBalance: true,
        requiresApproval: true,
        isSick: false,
        color: 'info',
        allowanceDays: 5,
        carryOverMaxDays: 0,
      });
      expect(ok.status).toBe(201);
      expect(leaveTypeSchema.parse(ok.body)).toMatchObject({
        key: null,
        name: 'Study leave',
        allowanceDays: 5,
      });
      const dup = await create({
        name: ' study LEAVE ',
        tracksBalance: false,
        requiresApproval: true,
        isSick: false,
        color: 'info',
      });
      expect([dup.status, errorBody(dup).params]).toEqual([409, { field: 'name' }]);
      expect(
        (
          await create({
            name: 'X',
            tracksBalance: false,
            requiresApproval: true,
            isSick: false,
            color: '#fff',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await create({
            name: 'Y',
            tracksBalance: true,
            requiresApproval: true,
            isSick: true,
            color: 'info',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await create({
            name: 'Z',
            tracksBalance: false,
            requiresApproval: true,
            isSick: false,
            color: 'info',
            key: 'annual',
          })
        ).status,
      ).toBe(400);
    });

    it('shows employees only active types, HR all, and keeps writes to HR/Admin', async () => {
      const hidden = (
        await hr.agent.post('/api/v1/leave/types').send({
          name: 'Hidden',
          tracksBalance: false,
          requiresApproval: true,
          isSick: false,
          color: 'danger',
        })
      ).body.id as string;
      expect(
        (await hr.agent.patch(`/api/v1/leave/types/${hidden}`).send({ isActive: false })).status,
      ).toBe(200);
      const forEmployee = (await dan.agent.get('/api/v1/leave/types')).body as { id: string }[];
      const forHr = (await hr.agent.get('/api/v1/leave/types')).body as { id: string }[];
      expect(forEmployee.some((t) => t.id === hidden)).toBe(false);
      expect(forHr.some((t) => t.id === hidden)).toBe(true);
      for (const who of [dan, mia]) {
        expect(
          (
            await who.agent.post('/api/v1/leave/types').send({
              name: 'No',
              tracksBalance: false,
              requiresApproval: true,
              isSick: false,
              color: 'info',
            })
          ).status,
        ).toBe(403);
        expect(
          (await who.agent.patch(`/api/v1/leave/types/${annual}`).send({ isActive: false })).status,
        ).toBe(403);
      }
      expect((await dan.agent.get('/api/v1/leave/settings')).status).toBe(403);
    });

    it('protects what a system type means and what a used custom type means', async () => {
      const patch = (id: string, b: object) => hr.agent.patch(`/api/v1/leave/types/${id}`).send(b);
      expect((await patch(sick, { isSick: false })).status).toBe(403);
      expect((await patch(annual, { tracksBalance: false })).status).toBe(403);
      expect((await patch(annual, { name: 'Holiday' })).status).toBe(403);
      expect((await patch(sick, { requiresApproval: true })).status).toBe(200);
      expect((await patch(sick, { requiresApproval: false })).status).toBe(200);
      expect((await patch(UNKNOWN, { isActive: false })).status).toBe(404);
      expect((await patch(annual, {})).status).toBe(400);

      const custom = (
        await hr.agent.post('/api/v1/leave/types').send({
          name: 'Used',
          tracksBalance: false,
          requiresApproval: false,
          isSick: false,
          color: 'accent',
        })
      ).body.id as string;
      expect((await request(gus, custom, freshWeek(gus))).status).toBe(201);
      const flip = await patch(custom, { tracksBalance: true });
      expect([flip.status, errorBody(flip).params]).toEqual([409, { field: 'in_use' }]);
    });

    it('changes the annual allowance for people whose balance is created afterwards', async () => {
      const before = await onboard(acme, 'policyx');
      expect((await annualFigures(before)).entitled).toBe(20);
      expect(
        (
          await hr.agent
            .patch(`/api/v1/leave/types/${annual}`)
            .send({ allowanceDays: 25, carryOverMaxDays: 3 })
        ).status,
      ).toBe(200);
      const after = await onboard(acme, 'policyy');
      const figures = await annualFigures(after);
      expect(figures.entitled).toBe(25);
      expect((await annualFigures(before)).entitled).toBe(20); // frozen
      expect(
        (
          await hr.agent
            .patch(`/api/v1/leave/types/${annual}`)
            .send({ allowanceDays: 20, carryOverMaxDays: 5 })
        ).status,
      ).toBe(200);
    });

    it('settings are HR/Admin only and validated', async () => {
      const get = await hr.agent.get('/api/v1/leave/settings');
      expect(get.body).toEqual({ hideSickTypeFromTeam: false, defaultCountry: null });
      expect(
        (await hr.agent.put('/api/v1/leave/settings').send({ defaultCountry: 'BGR' })).status,
      ).toBe(400);
      expect((await hr.agent.put('/api/v1/leave/settings').send({})).status).toBe(400);
      expect(
        (await dan.agent.put('/api/v1/leave/settings').send({ hideSickTypeFromTeam: true })).status,
      ).toBe(403);
      const set = await hr.agent.put('/api/v1/leave/settings').send({ defaultCountry: 'bg' });
      expect(set.body).toEqual({ hideSickTypeFromTeam: false, defaultCountry: 'BG' });
      expect(
        (await hr.agent.put('/api/v1/leave/settings').send({ defaultCountry: null })).body
          .defaultCountry,
      ).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('holidays', () => {
    it('lists built-in national days of a country and custom days, and defaults to the own country', async () => {
      const de = (await dan.agent.get('/api/v1/leave/holidays?year=2026&country=DE')).body as {
        date: string;
        key: string | null;
      }[];
      expect(de.find((h) => h.key === 'DE.easter_monday')?.date).toBe('2026-04-06');
      expect(de.find((h) => h.key === 'DE.unity_day')?.date).toBe('2026-10-03');
      expect((await dan.agent.get('/api/v1/leave/holidays?year=2026')).body).toEqual([]); // no country known
      await hr.agent.put('/api/v1/leave/settings').send({ defaultCountry: 'BG' });
      const bg = (await dan.agent.get('/api/v1/leave/holidays?year=2026')).body as {
        key: string | null;
      }[];
      expect(bg.some((h) => h.key === 'BG.liberation_day')).toBe(true);
      await hr.agent.put('/api/v1/leave/settings').send({ defaultCountry: null });
      expect((await dan.agent.get('/api/v1/leave/holidays?year=1999&country=DE')).status).toBe(400);
      expect((await dan.agent.get('/api/v1/leave/holidays')).status).toBe(400);
    });

    it('lets HR add and remove company days, once per date and country', async () => {
      const add = (b: object) => hr.agent.post('/api/v1/leave/holidays').send(b);
      const day = monday(30);
      const created = await add({ date: day, name: 'Company day', country: null, halfDay: false });
      expect(created.status).toBe(201);
      const dup = await add({ date: day, name: 'Again' });
      expect([dup.status, errorBody(dup).params]).toEqual([409, { field: 'date' }]);
      expect((await add({ date: day, name: 'Only DE', country: 'DE' })).status).toBe(201); // other country: fine
      expect((await add({ date: '2026-02-30', name: 'Bad' })).status).toBe(400);
      expect(
        (await dan.agent.post('/api/v1/leave/holidays').send({ date: day, name: 'No' })).status,
      ).toBe(403);
      const year = Number(day.slice(0, 4));
      const listed = (await dan.agent.get(`/api/v1/leave/holidays?year=${year}&country=BG`))
        .body as { id: string | null; name: string | null }[];
      expect(listed.some((h) => h.name === 'Company day')).toBe(true);
      expect(listed.some((h) => h.name === 'Only DE')).toBe(false);
      expect((await hr.agent.delete(`/api/v1/leave/holidays/${created.body.id}`)).status).toBe(204);
      expect((await hr.agent.delete(`/api/v1/leave/holidays/${created.body.id}`)).status).toBe(404);
      expect((await dan.agent.delete(`/api/v1/leave/holidays/${UNKNOWN}`)).status).toBe(403);
    });

    it('does not count holidays as leave days, and half-day holidays as half', async () => {
      const person = await onboard(acme, 'holidayx', 'employee', { country: 'DE' });
      const w = freshWeek(person);
      const wed = addDays(w.startDate, 2);
      const thu = addDays(w.startDate, 3);
      await hr.agent
        .post('/api/v1/leave/holidays')
        .send({ date: wed, name: 'Full', country: 'DE', halfDay: false });
      await hr.agent
        .post('/api/v1/leave/holidays')
        .send({ date: thu, name: 'Half', country: 'DE', halfDay: true });
      const preview = leavePreviewSchema.parse(
        (await person.agent.post('/api/v1/leave/requests/preview').send(body(annual, w))).body,
      );
      expect(preview.days).toBe(3.5);
      expect(preview.dates.map((d) => d.date)).not.toContain(wed);
      // the same week for someone in another country counts fully
      const other = await onboard(acme, 'holidayy', 'employee', { country: 'BG' });
      expect(
        leavePreviewSchema.parse(
          (await other.agent.post('/api/v1/leave/requests/preview').send(body(annual, w))).body,
        ).days,
      ).toBe(5);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('balances', () => {
    it('shows the own annual balance, entitled in full without a hire date', async () => {
      const person = await onboard(acme, 'balx');
      const f = await annualFigures(person);
      expect(f).toMatchObject({
        entitled: 20,
        carriedOver: 0,
        adjustment: 0,
        used: 0,
        pending: 0,
        remaining: 20,
      });
    });

    it('prorates the entitlement in the hire year', async () => {
      const year = Number(today.slice(0, 4));
      const hired = `${year}-07-02`;
      const person = await onboard(acme, 'balprorate', 'employee', { hireDate: hired });
      expect((await annualFigures(person, undefined, year)).entitled).toBe(
        proratedAllowance(20, hired, year),
      );
      expect(proratedAllowance(20, hired, year)).toBe(10);
    });

    it('lets managers see their people, HR everybody, and nobody else', async () => {
      expect((await balance(mia, dan.employeeId)).status).toBe(200); // direct report
      expect((await balance(mia, eve.employeeId)).status).toBe(200); // below, scope "team"
      const gusRes = await balance(mia, gus.employeeId);
      expect([gusRes.status, errorBody(gusRes).code]).toEqual([403, 'FORBIDDEN']);
      expect((await balance(hr, gus.employeeId)).status).toBe(200);
      expect((await balance(dan, eve.employeeId)).status).toBe(403);
      expect((await balance(dan, dan.employeeId)).status).toBe(200);
      expect((await balance(dan, UNKNOWN)).status).toBe(404);
      expect((await dan.agent.get('/api/v1/leave/balances?employeeId=nope')).status).toBe(400);
      expect((await dan.agent.get('/api/v1/leave/balances?year=1999')).status).toBe(400);
    });

    it('adjusts a balance, audited, within limits', async () => {
      const person = await onboard(acme, 'baladj');
      const adjust = (who: Member, b: object) =>
        who.agent.post('/api/v1/leave/balances/adjustments').send(b);
      const year = testYear;
      const base = { employeeId: person.employeeId, leaveTypeId: annual, year, delta: 2.5 };
      const ok = await adjust(hr, base);
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ adjustment: 2.5, remaining: 22.5 });
      expect((await annualFigures(person)).remaining).toBe(22.5);
      const log = await system.auditLog.findFirstOrThrow({
        where: { action: 'leave.balance_adjusted', entityId: person.employeeId },
      });
      expect(log.after).toEqual({ leaveTypeId: annual, year, delta: 2.5 });

      for (const [label, b, status] of [
        ['zero', { ...base, delta: 0 }, 400],
        ['quarter day', { ...base, delta: 0.25 }, 400],
        ['too large', { ...base, delta: 61 }, 400],
        ['below zero', { ...base, delta: -60 }, 400],
        ['unknown employee', { ...base, employeeId: UNKNOWN }, 404],
        ['a type without balance', { ...base, leaveTypeId: unpaid }, 400],
      ] as const) {
        expect((await adjust(hr, b)).status, label).toBe(status);
      }
      for (const who of [dan, mia]) expect((await adjust(who, base)).status).toBe(403);
      expect((await annualFigures(person)).adjustment).toBe(2.5);
    });

    it('carries unused days into the next year, capped by the policy', async () => {
      const person = await onboard(acme, 'carryx');
      const year = Number(today.slice(0, 4));
      // last year: 20 entitled, 12 used (approved days stored directly) -> 8 left, cap 5
      await asTenant(acme.tenantId, async (tx) => {
        await tx.leaveBalance.create({
          data: {
            employeeId: person.employeeId,
            leaveTypeId: annual,
            year: year - 1,
            entitled: 20,
          },
        });
        const r = await tx.leaveRequest.create({
          data: {
            employeeId: person.employeeId,
            leaveTypeId: annual,
            status: 'approved',
            days: 12,
            startDate: new Date(`${year - 1}-03-02T00:00:00Z`),
            endDate: new Date(`${year - 1}-03-17T00:00:00Z`),
          },
        });
        await tx.leaveRequestDay.createMany({
          data: Array.from({ length: 12 }, (_, i) => ({
            requestId: r.id,
            day: new Date(Date.UTC(year - 1, 5, 1 + i)),
            fraction: 1,
          })),
        });
      });
      const f = await annualFigures(person, undefined, year);
      expect(f).toMatchObject({ entitled: 20, carriedOver: 5, remaining: 25 });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('requesting leave', () => {
    it('previews the counted days without saving anything', async () => {
      const w = freshWeek(dan);
      const before = await system.leaveRequest.count();
      const p = leavePreviewSchema.parse(
        (await dan.agent.post('/api/v1/leave/requests/preview').send(body(annual, w))).body,
      );
      expect(p).toMatchObject({ days: 5, enough: true });
      expect(p.remainingAfter).toBe((await annualFigures(dan)).remaining - 5);
      expect(await system.leaveRequest.count()).toBe(before);
      const weekend = leavePreviewSchema.parse(
        (
          await dan.agent.post('/api/v1/leave/requests/preview').send(
            body(annual, {
              startDate: addDays(w.startDate, 5),
              endDate: addDays(w.startDate, 6),
            }),
          )
        ).body,
      );
      expect(weekend.days).toBe(0);
    });

    it('creates a pending annual request, counted as pending in the balance', async () => {
      const person = await onboard(acme, 'reqx');
      await manage(acme, person.employeeId, mia.employeeId);
      const w = freshWeek(person);
      const res = await request(person, annual, w, { reason: ' Family trip ' });
      expect(res.status).toBe(201);
      const r = leaveRequestSchema.parse(res.body);
      expect(r).toMatchObject({
        status: 'pending',
        days: 5,
        reason: 'Family trip',
        masked: false,
        canCancel: true,
        canApprove: false,
      });
      expect(r.leaveType).toMatchObject({ key: 'annual' });
      expect(await annualFigures(person)).toMatchObject({ pending: 5, used: 0, remaining: 15 });
      const days = await system.leaveRequestDay.findMany({ where: { requestId: r.id } });
      expect(days).toHaveLength(5);
    });

    it('counts half days', async () => {
      const person = await onboard(acme, 'reqhalf');
      const w = freshWeek(person);
      const res = await request(person, annual, w, { halfDayStart: true, halfDayEnd: true });
      expect(leaveRequestSchema.parse(res.body).days).toBe(4);
      const single = await request(
        person,
        annual,
        { startDate: addDays(w.endDate, 3), endDate: addDays(w.endDate, 3) },
        { halfDayEnd: true },
      );
      expect(leaveRequestSchema.parse(single.body).days).toBe(0.5);
    });

    it.each([
      [
        'an end before the start',
        (w: { startDate: string; endDate: string }) => ({
          startDate: w.endDate,
          endDate: w.startDate,
        }),
        400,
        'VALIDATION_FAILED',
      ],
      [
        'only a weekend',
        (w: { startDate: string; endDate: string }) => ({
          startDate: addDays(w.startDate, 5),
          endDate: addDays(w.startDate, 6),
        }),
        400,
        'NO_WORKING_DAYS',
      ],
      [
        'a start more than 60 days back',
        () => ({ startDate: addDays(today, -61), endDate: addDays(today, -60) }),
        400,
        'VALIDATION_FAILED',
      ],
      [
        'an end more than two years ahead',
        () => ({ startDate: addDays(today, 365 * 2 + 30), endDate: addDays(today, 365 * 2 + 31) }),
        400,
        'VALIDATION_FAILED',
      ],
      [
        'a request longer than a year',
        (w: { startDate: string }) => ({
          startDate: w.startDate,
          endDate: addDays(w.startDate, 400),
        }),
        400,
        'VALIDATION_FAILED',
      ],
    ])('rejects %s', async (_label, make, status, code) => {
      const person = await onboard(acme, `rej${uniq++}x`);
      const w = freshWeek(person);
      const res = await request(person, annual, make(w));
      expect([res.status, errorBody(res).code]).toEqual([status, code]);
      expect(await system.leaveRequest.count({ where: { employeeId: person.employeeId } })).toBe(0);
    });

    it('rejects half-day on both ends of one day, unknown types, inactive types and mass assignment', async () => {
      const person = await onboard(acme, 'rejmore');
      const w = freshWeek(person);
      const day = { startDate: w.startDate, endDate: w.startDate };
      expect(
        (await request(person, annual, day, { halfDayStart: true, halfDayEnd: true })).status,
      ).toBe(400);
      expect((await request(person, UNKNOWN, w)).status).toBe(400);
      const off = (
        await hr.agent.post('/api/v1/leave/types').send({
          name: 'Off',
          tracksBalance: false,
          requiresApproval: true,
          isSick: false,
          color: 'info',
        })
      ).body.id as string;
      await hr.agent.patch(`/api/v1/leave/types/${off}`).send({ isActive: false });
      expect((await request(person, off, w)).status).toBe(400);
      for (const extra of [{ employeeId: gus.employeeId }, { status: 'approved' }, { days: 1 }]) {
        const res = await request(person, annual, w, extra);
        expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
      }
      expect(
        (await request(person, annual, { startDate: '31.10.2026', endDate: w.endDate })).status,
      ).toBe(400);
    });

    it('needs an employee record and an active employee', async () => {
      const lone = await (async () => {
        const res = await acme.admin.agent
          .post('/api/v1/users/invitations')
          .send({ email: 'lonex@acme.eu' });
        expect(res.status).toBe(201);
        return accept('lonex@acme.eu');
      })();
      const res = await request(lone, annual, freshWeek(lone));
      expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      expect(
        (await lone.agent.post('/api/v1/leave/requests/preview').send(body(annual, freshWeek())))
          .status,
      ).toBe(404);
    });

    it('requires sign-in', async () => {
      const { agent } = httpWorkspaceHelpers(() => app);
      expect(
        (await agent().post('/api/v1/leave/requests').send(body(annual, freshWeek()))).status,
      ).toBe(401);
      expect((await agent().get('/api/v1/leave/requests')).status).toBe(401);
    });

    it('allows exactly the remaining balance and refuses half a day more, with the numbers', async () => {
      const person = await onboard(acme, 'exactx');
      const first = week(reserve(person, 4));
      // four working weeks, the last day only until noon: 19.5 days
      const big = await request(
        person,
        annual,
        { startDate: first.startDate, endDate: addDays(first.startDate, 25) },
        { halfDayEnd: true },
      );
      expect(big.status).toBe(201);
      expect(leaveRequestSchema.parse(big.body).days).toBe(19.5);
      expect((await annualFigures(person)).remaining).toBe(0.5);

      // too much: refused, nothing is saved
      const w = freshWeek(person);
      const over = await request(person, annual, {
        startDate: w.startDate,
        endDate: addDays(w.startDate, 1),
      });
      expect([over.status, errorBody(over).code]).toEqual([409, 'INSUFFICIENT_BALANCE']);
      expect(errorBody(over).params).toMatchObject({ available: 0.5, requested: 2 });
      expect(await system.leaveRequest.count({ where: { employeeId: person.employeeId } })).toBe(1);

      // exactly what is left is fine, then nothing more
      const exact = await request(
        person,
        annual,
        { startDate: w.startDate, endDate: w.startDate },
        { halfDayStart: true },
      );
      expect(exact.status).toBe(201);
      expect((await annualFigures(person)).remaining).toBe(0);
      const day2 = addDays(w.startDate, 1);
      const more = await request(
        person,
        annual,
        { startDate: day2, endDate: day2 },
        { halfDayEnd: true },
      );
      expect([more.status, errorBody(more).code]).toEqual([409, 'INSUFFICIENT_BALANCE']);
      // a type without balance is not affected
      expect((await request(person, unpaid, { startDate: day2, endDate: day2 })).status).toBe(201);
    });

    it('does not let two simultaneous requests together exceed the balance', async () => {
      const person = await onboard(acme, 'racex');
      await annualFigures(person); // the balance row exists, so the race is decided by the lock alone
      const a = week(reserve(person, 4));
      const b = week(reserve(person, 4));
      // two 15 day requests cannot both fit into 20 days
      const results = await Promise.all([
        request(person, annual, { startDate: a.startDate, endDate: addDays(a.startDate, 18) }),
        request(person, annual, { startDate: b.startDate, endDate: addDays(b.startDate, 18) }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await annualFigures(person)).remaining).toBe(5);
    });

    it('refuses overlapping requests but allows adjacent ones and re-requesting after a cancel', async () => {
      const person = await onboard(acme, 'overlapx');
      const w = freshWeek(person);
      const first = await request(person, annual, w);
      expect(first.status).toBe(201);
      for (const other of [
        { startDate: w.endDate, endDate: addDays(w.endDate, 3) }, // shares the last day
        { startDate: addDays(w.startDate, -2), endDate: w.startDate }, // shares the first day
        { startDate: addDays(w.startDate, 1), endDate: addDays(w.startDate, 2) }, // inside
      ]) {
        const res = await request(person, unpaid, other);
        expect([res.status, errorBody(res).params]).toEqual([409, { field: 'dates' }]);
      }
      // the next Monday is free
      expect(
        (
          await request(person, unpaid, {
            startDate: addDays(w.startDate, 7),
            endDate: addDays(w.startDate, 8),
          })
        ).status,
      ).toBe(201);
      // cancelled requests do not block
      expect((await decide(person, first.body.id, 'cancel')).status).toBe(200);
      expect((await request(person, annual, w)).status).toBe(201);
    });

    it('splits a request over New Year across both years', async () => {
      const person = await onboard(acme, 'newyearx');
      const year = testYear;
      let start = `${year}-12-22`;
      while (weekday(start) !== 1) start = addDays(start, 1); // the Monday between 22 and 28 December
      const res = await request(person, annual, { startDate: start, endDate: addDays(start, 11) });
      expect(res.status).toBe(201);
      const thisYear = leaveBalancesSchema
        .parse((await balance(person, undefined, year)).body)
        .balances.find((b) => b.leaveTypeId === annual)!;
      const nextYear = leaveBalancesSchema
        .parse((await balance(person, undefined, year + 1)).body)
        .balances.find((b) => b.leaveTypeId === annual)!;
      expect(thisYear.pending + nextYear.pending).toBe(leaveRequestSchema.parse(res.body).days);
      expect(thisYear.pending).toBeGreaterThan(0);
      expect(nextYear.pending).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('sick leave', () => {
    it('is approved immediately, never stores a reason and has no balance limit', async () => {
      const person = await onboard(acme, 'sickx');
      await manage(acme, person.employeeId, mia.employeeId);
      const res = await request(person, sick, freshWeek(person), { reason: 'Migraine and flu' });
      expect(res.status).toBe(201);
      const r = leaveRequestSchema.parse(res.body);
      expect(r).toMatchObject({ status: 'approved', reason: null });
      const row = await system.leaveRequest.findUniqueOrThrow({ where: { id: r.id } });
      expect(row.reason).toBeNull();
      expect(
        JSON.stringify(await system.auditLog.findMany({ where: { entityId: r.id } })),
      ).not.toMatch(/Migraine/);
      // 30 days of sick leave: no balance involved
      const long = await request(person, sick, {
        startDate: monday(60),
        endDate: addDays(monday(60), 40),
      });
      expect(long.status).toBe(201);
      expect((await annualFigures(person)).used).toBe(0);
    });

    it('only informs the manager', async () => {
      const person = await onboard(acme, 'informx');
      await manage(acme, person.employeeId, mia.employeeId);
      const res = await request(person, sick, freshWeek(person));
      const requestId = res.body.id as string;
      const items = await notificationsOf(mia);
      const note = items.find(
        (n) => n.type === 'leave.requested' && n.params.requestId === requestId,
      );
      expect(note?.params).toMatchObject({ autoApproved: true, employeeName: 'informx Test' });
      // the notification never names the type
      expect(JSON.stringify(note)).not.toMatch(/sick/i);
    });

    it('hides the type from colleagues only when the workspace chooses so', async () => {
      const person = await onboard(acme, 'sickhide');
      await manage(acme, person.employeeId, dan.employeeId); // dan's report; mia is above (scope team)
      const w = freshWeek(person);
      const created = await request(person, sick, w);
      const id = created.body.id as string;
      const seenBy = async (who: Member) => {
        const list = leaveRequestListSchema.parse(
          (await who.agent.get('/api/v1/leave/requests').query({ employeeId: person.employeeId }))
            .body,
        );
        return list.items.find((r) => r.id === id);
      };
      expect((await seenBy(mia))?.leaveType?.key).toBe('sick'); // default: visible
      await hr.agent.put('/api/v1/leave/settings').send({ hideSickTypeFromTeam: true });
      try {
        const masked = await seenBy(mia);
        expect(masked).toMatchObject({ masked: true, leaveType: null, status: 'approved' });
        expect((await seenBy(person))?.leaveType?.key).toBe('sick'); // the owner always sees it
        expect((await seenBy(hr))?.leaveType?.key).toBe('sick'); // scope "all" sees it
        // other types are never masked
        const other = await request(person, unpaid, freshWeek(person));
        const unmasked = leaveRequestListSchema
          .parse(
            (await mia.agent.get('/api/v1/leave/requests').query({ employeeId: person.employeeId }))
              .body,
          )
          .items.find((r) => r.id === other.body.id);
        expect(unmasked?.leaveType?.key).toBe('unpaid');
      } finally {
        await hr.agent.put('/api/v1/leave/settings').send({ hideSickTypeFromTeam: false });
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('who sees what', () => {
    it('shows people their own requests only, managers their subtree, HR everybody', async () => {
      const w = freshWeek(eve);
      const own = (await request(eve, unpaid, w)).body.id as string;
      const idsFor = async (who: Member, query: object = {}) =>
        leaveRequestListSchema
          .parse(
            (await who.agent.get('/api/v1/leave/requests').query({ pageSize: 100, ...query })).body,
          )
          .items.map((r) => r.id);
      expect(await idsFor(eve)).toContain(own);
      expect(await idsFor(gus)).not.toContain(own);
      expect(await idsFor(dan)).not.toContain(own); // a plain employee sees nobody else's
      expect(await idsFor(mia)).toContain(own); // eve is below mia
      expect(await idsFor(hr)).toContain(own);
      expect(await idsFor(globex.admin)).not.toContain(own);
    });

    it('shows the reason and comment only to the owner and to people who may decide', async () => {
      const person = await onboard(acme, 'reasonx');
      await manage(acme, person.employeeId, dan.employeeId); // approver is dan? no: dan is an employee
      await manage(acme, person.employeeId, mia.employeeId);
      const id = (await request(person, annual, freshWeek(person), { reason: 'Private matter' }))
        .body.id as string;
      const one = async (who: Member) =>
        leaveRequestListSchema
          .parse(
            (await who.agent.get('/api/v1/leave/requests').query({ employeeId: person.employeeId }))
              .body,
          )
          .items.find((r) => r.id === id);
      expect((await one(person))?.reason).toBe('Private matter');
      expect((await one(mia))?.reason).toBe('Private matter'); // direct manager may approve
      expect((await one(hr))?.reason).toBe('Private matter');
      // a viewer who can see but not decide: put the request owner two levels below mia
      const deep = await onboard(acme, 'reasondeep');
      await manage(acme, deep.employeeId, eve.employeeId);
      const deepId = (await request(deep, annual, freshWeek(deep), { reason: 'Deep secret' })).body
        .id as string;
      const seenByMia = leaveRequestListSchema
        .parse(
          (await mia.agent.get('/api/v1/leave/requests').query({ employeeId: deep.employeeId }))
            .body,
        )
        .items.find((r) => r.id === deepId);
      expect(seenByMia).toMatchObject({ reason: null, canApprove: false });
    });

    it('filters by status, dates and employee, and pages', async () => {
      const person = await onboard(acme, 'filterx');
      const w1 = freshWeek(person);
      const w2 = freshWeek(person);
      const a = (await request(person, annual, w1)).body.id as string;
      const b = (await request(person, unpaid, w2)).body.id as string;
      await decide(person, b, 'cancel');
      const list = async (q: object) =>
        leaveRequestListSchema.parse(
          (await person.agent.get('/api/v1/leave/requests').query(q)).body,
        );
      expect((await list({ status: 'cancelled' })).items.map((r) => r.id)).toEqual([b]);
      expect((await list({ status: 'pending' })).items.map((r) => r.id)).toEqual([a]);
      expect((await list({ from: w1.startDate, to: w1.endDate })).items.map((r) => r.id)).toEqual([
        a,
      ]);
      expect(
        (await list({ from: addDays(w1.endDate, 1), to: addDays(w1.endDate, 2) })).items,
      ).toEqual([]);
      const paged = await list({ pageSize: 1, page: 2 });
      expect(paged).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect(paged.items).toHaveLength(1);
      // asking for somebody outside the scope yields nothing, not an error and not their data
      const other = leaveRequestListSchema.parse(
        (await person.agent.get('/api/v1/leave/requests').query({ employeeId: gus.employeeId }))
          .body,
      );
      expect(other.items).toEqual([]);
      for (const bad of [
        { status: 'deleted' },
        { page: 0 },
        { pageSize: 101 },
        { from: 'x' },
        { approvable: 'maybe' },
      ]) {
        expect((await person.agent.get('/api/v1/leave/requests').query(bad)).status).toBe(400);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('approving and rejecting', () => {
    const pendingFor = async (who: Person) =>
      (await request(who, annual, freshWeek(who), { reason: 'x' })).body.id as string;

    it('lets the direct manager approve; the days move from pending to used', async () => {
      const id = await pendingFor(dan);
      const before = await annualFigures(dan);
      const res = await decide(mia, id, 'approve', 'Enjoy!');
      expect(res.status).toBe(200);
      expect(leaveRequestSchema.parse(res.body)).toMatchObject({
        status: 'approved',
        decisionComment: 'Enjoy!',
        canApprove: false,
      });
      const after = await annualFigures(dan);
      expect(after.used).toBe(before.used + 5);
      expect(after.pending).toBe(before.pending - 5);
      expect(after.remaining).toBe(before.remaining);
      const approval = await system.leaveApproval.findFirstOrThrow({ where: { requestId: id } });
      expect(approval).toMatchObject({
        decision: 'approved',
        comment: 'Enjoy!',
        approverEmployeeId: mia.employeeId,
      });
    });

    it('tells the requester about the decision', async () => {
      const id = await pendingFor(dan);
      await decide(mia, id, 'reject', 'Not this week');
      const items = await notificationsOf(dan);
      const note = items.find((n) => n.type === 'leave.decided' && n.params.requestId === id);
      expect(note?.params).toMatchObject({ status: 'rejected' });
      expect(JSON.stringify(note)).not.toMatch(/Not this week/); // the comment is never in a notification
    });

    it('a rejection frees the days and keeps the comment for the owner', async () => {
      const person = await onboard(acme, 'rejectx');
      await manage(acme, person.employeeId, mia.employeeId);
      const id = await pendingFor(person);
      expect((await annualFigures(person)).pending).toBe(5);
      const res = await decide(mia, id, 'reject', 'Busy period');
      expect(leaveRequestSchema.parse(res.body)).toMatchObject({
        status: 'rejected',
        decisionComment: 'Busy period',
      });
      expect(await annualFigures(person)).toMatchObject({ pending: 0, used: 0, remaining: 20 });
      const mine = leaveRequestListSchema.parse(
        (await person.agent.get('/api/v1/leave/requests').query({ status: 'rejected' })).body,
      );
      expect(mine.items[0]?.decisionComment).toBe('Busy period');
    });

    it('limits managers to direct reports and lets HR/Admin decide for everybody', async () => {
      const id = await pendingFor(eve); // eve reports to dan, below mia
      const noScope = await decide(mia, id, 'approve');
      expect([noScope.status, errorBody(noScope).code]).toEqual([403, 'FORBIDDEN']);
      expect((await decide(hr, id, 'approve')).status).toBe(200);
      const gusId = await pendingFor(gus);
      expect((await decide(mia, gusId, 'reject')).status).toBe(403);
      expect((await decide(acme.admin, gusId, 'reject')).status).toBe(200);
    });

    it('never lets anybody decide their own request, whatever their role', async () => {
      const miaId = await pendingFor(mia);
      for (const who of [mia]) {
        const res = await decide(who, miaId, 'approve');
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
        expect((await decide(who, miaId, 'reject')).status).toBe(403);
      }
      const hrId = await pendingFor(hr);
      expect((await decide(hr, hrId, 'approve')).status).toBe(403);
      const adminReq = (
        await request({ ...acme.admin, employeeId: adminEmployeeId } as Person, annual, freshWeek())
      ).body.id as string;
      expect((await decide(acme.admin, adminReq, 'approve')).status).toBe(403);
      // escalation: somebody else can
      expect((await decide(acme.admin, miaId, 'approve')).status).toBe(200); // manager's request -> her manager (admin)
      expect((await decide(acme.admin, hrId, 'approve')).status).toBe(200); // HR's request -> admin
      expect((await decide(hr, adminReq, 'approve')).status).toBe(200); // admin's request -> HR
      for (const id of [miaId, hrId, adminReq]) {
        const row = await system.leaveRequest.findUniqueOrThrow({ where: { id } });
        expect(row.status).toBe('approved');
      }
    });

    it('decides a request once, even when two approvers act at the same time', async () => {
      const id = await pendingFor(dan);
      const results = await Promise.all([
        decide(mia, id, 'approve'),
        decide(hr, id, 'reject'),
        decide(acme.admin, id, 'approve'),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409).map((r) => errorBody(r).params)).toEqual([
        { field: 'status' },
        { field: 'status' },
      ]);
      expect(await system.leaveApproval.count({ where: { requestId: id } })).toBe(1);
    });

    it('rejects deciding twice, long comments, unknown ids and non-approvers', async () => {
      const id = await pendingFor(dan);
      expect((await decide(mia, id, 'approve')).status).toBe(200);
      const again = await decide(mia, id, 'reject');
      expect([again.status, errorBody(again).params]).toEqual([409, { field: 'status' }]);
      const fresh = await pendingFor(dan);
      expect((await decide(mia, fresh, 'approve', 'x'.repeat(301))).status).toBe(400);
      expect(
        (
          await mia.agent
            .post(`/api/v1/leave/requests/${fresh}/approve`)
            .send({ status: 'approved' })
        ).status,
      ).toBe(400);
      expect((await decide(mia, UNKNOWN, 'approve')).status).toBe(404);
      expect((await mia.agent.post('/api/v1/leave/requests/nope/approve').send({})).status).toBe(
        400,
      );
      for (const who of [dan, eve, gus]) {
        const res = await decide(who, fresh, 'approve');
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      }
    });

    it('lists what a person may decide, never their own', async () => {
      const mine = await pendingFor(mia);
      const forDan = await pendingFor(dan);
      const forEve = await pendingFor(eve);
      const ids = async (who: Member) =>
        leaveRequestListSchema
          .parse(
            (
              await who.agent
                .get('/api/v1/leave/requests')
                .query({ approvable: 'true', pageSize: 100 })
            ).body,
          )
          .items.map((r) => r.id);
      const miaIds = await ids(mia);
      expect(miaIds).toContain(forDan);
      expect(miaIds).not.toContain(forEve); // below her, but not a direct report
      expect(miaIds).not.toContain(mine); // her own
      const hrIds = await ids(hr);
      expect(hrIds).toEqual(expect.arrayContaining([forDan, forEve, mine]));
      expect(await ids(dan)).toEqual([]);
      expect((await ids(acme.admin)).length).toBeGreaterThan(0);
      // after deciding it disappears
      await decide(mia, forDan, 'approve');
      expect(await ids(mia)).not.toContain(forDan);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('cancelling', () => {
    it('lets the owner cancel a pending or a future approved request and frees the days', async () => {
      const person = await onboard(acme, 'cancelx');
      await manage(acme, person.employeeId, mia.employeeId);
      const id = (await request(person, annual, freshWeek(person))).body.id as string;
      expect((await annualFigures(person)).pending).toBe(5);
      const res = await decide(person, id, 'cancel');
      expect(leaveRequestSchema.parse(res.body)).toMatchObject({
        status: 'cancelled',
        canCancel: false,
      });
      expect(await annualFigures(person)).toMatchObject({ pending: 0, used: 0 });

      const approved = (await request(person, annual, freshWeek(person))).body.id as string;
      await decide(mia, approved, 'approve');
      expect((await decide(person, approved, 'cancel')).status).toBe(200);
      const items = await notificationsOf(mia);
      expect(
        items.some(
          (n) =>
            n.type === 'leave.cancelled' &&
            n.params.requestId === approved &&
            n.params.by === 'employee',
        ),
      ).toBe(true);
      const again = await decide(person, approved, 'cancel');
      expect([again.status, errorBody(again).params]).toEqual([409, { field: 'status' }]);
    });

    it('does not let the owner cancel leave that has already started; an approver can', async () => {
      const person = await onboard(acme, 'cancelpast');
      await manage(acme, person.employeeId, mia.employeeId);
      let start = addDays(today, -7);
      while (weekday(start) !== 1) start = addDays(start, 1);
      const id = (await request(person, annual, { startDate: start, endDate: addDays(start, 4) }))
        .body.id as string;
      await decide(mia, id, 'approve');
      const owner = await decide(person, id, 'cancel');
      expect([owner.status, errorBody(owner).params]).toEqual([409, { field: 'status' }]);
      const byManager = await decide(mia, id, 'cancel', 'Booked by mistake');
      expect(leaveRequestSchema.parse(byManager.body).status).toBe('cancelled');
      const items = await notificationsOf(person);
      expect(items.some((n) => n.type === 'leave.cancelled' && n.params.by === 'approver')).toBe(
        true,
      );
      expect(JSON.stringify(items)).not.toMatch(/Booked by mistake/);
    });

    it('does not let colleagues or other managers cancel', async () => {
      const id = (await request(dan, annual, freshWeek(dan))).body.id as string;
      for (const who of [gus, eve]) {
        const res = await decide(who, id, 'cancel');
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      }
      const other = await onboard(acme, 'othermgr', 'manager');
      expect((await decide(other, id, 'cancel')).status).toBe(403);
      expect((await decide(globex.admin, id, 'cancel')).status).toBe(404);
      expect((await decide(mia, UNKNOWN, 'cancel')).status).toBe(404);
      expect((await decide(mia, id, 'cancel')).status).toBe(200); // her direct report
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('notifying approvers', () => {
    it('tells the manager when the manager may approve', async () => {
      const id = (await request(dan, annual, freshWeek(dan))).body.id as string;
      const items = await notificationsOf(mia);
      const note = items.find((n) => n.type === 'leave.requested' && n.params.requestId === id);
      expect(note?.params).toMatchObject({
        employeeName: 'dan Test',
        days: 5,
        autoApproved: false,
      });
      expect(JSON.stringify(note)).not.toMatch(/annual|reason/i);
      // not HR: the manager is the approver
      const hrItems = await notificationsOf(hr);
      expect(hrItems.some((n) => n.params.requestId === id)).toBe(false);
    });

    it('falls back to HR and Admin when there is no manager, but never to the requester', async () => {
      const id = (await request(gus, annual, freshWeek(gus))).body.id as string;
      for (const who of [hr, acme.admin]) {
        expect(
          (await notificationsOf(who)).some(
            (n) => n.type === 'leave.requested' && n.params.requestId === id,
          ),
        ).toBe(true);
      }
      expect((await notificationsOf(gus)).some((n) => n.params.requestId === id)).toBe(false);
      // an approver's own request does not notify themselves
      const hrId = (await request(hr, annual, freshWeek(hr))).body.id as string;
      expect(
        (await notificationsOf(hr)).some(
          (n) => n.type === 'leave.requested' && n.params.requestId === hrId,
        ),
      ).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('when an employee leaves', () => {
    const mkPerson = async (name: string, role: SystemRole, managerId: string) => {
      const who = await onboard(acme, name, role);
      expect((await manage(acme, who.employeeId, managerId)).status).toBe(204);
      const adjust = await hr.agent.post('/api/v1/leave/balances/adjustments').send({
        employeeId: who.employeeId,
        leaveTypeId: annual,
        year: testYear,
        delta: 60,
      });
      expect(adjust.status).toBe(201);
      return who;
    };
    const deactivate = (employeeId: string) =>
      hr.agent.post(`/api/v1/employees/${employeeId}/deactivate`).send({});
    const statusOf = async (who: Member, id: string) =>
      (await who.agent.get('/api/v1/leave/requests').query({ pageSize: 100 })).body.items.find(
        (r: { id: string }) => r.id === id,
      )?.status as string | undefined;

    it('keeps pending requests of the leaver, still decided by their manager', async () => {
      const boss = await mkPerson('lvboss', 'manager', adminEmployeeId);
      const leaver = await mkPerson('lvleaver', 'employee', boss.employeeId);
      const id = (await request(leaver, annual, freshWeek(leaver))).body.id as string;

      expect((await deactivate(leaver.employeeId)).status).toBe(200);

      expect(await statusOf(boss, id)).toBe('pending');
      const pending = await boss.agent.get('/api/v1/leave/requests').query({ approvable: true });
      expect(pending.body.items.map((r: { id: string }) => r.id)).toContain(id);
      // an unrelated manager still has no say
      expect((await decide(mia, id, 'approve')).status).toBe(403);
      expect((await decide(boss, id, 'approve')).status).toBe(200);
    });

    it('hands the pending requests of a leaving manager’s reports to the next manager', async () => {
      const boss = await mkPerson('inhboss', 'manager', adminEmployeeId);
      const sub = await mkPerson('inhsub', 'employee', boss.employeeId);
      const pending = (await request(sub, annual, freshWeek(sub))).body.id as string;
      const decided = (await request(sub, annual, freshWeek(sub))).body.id as string;
      expect((await decide(boss, decided, 'approve')).status).toBe(200);
      const rejected = (await request(sub, annual, freshWeek(sub))).body.id as string;
      expect((await decide(boss, rejected, 'reject')).status).toBe(200);
      // the new approver has not been told yet, and is not the boss's own request notified to anyone else
      expect((await notificationsOf(acme.admin)).some((n) => n.params.requestId === pending)).toBe(
        false,
      );

      expect((await deactivate(boss.employeeId)).status).toBe(200);

      expect(await statusOf(sub, pending)).toBe('pending');
      const told = (await notificationsOf(acme.admin)).filter((n) => n.type === 'leave.requested');
      expect(told.filter((n) => n.params.requestId === pending)).toHaveLength(1);
      expect(told[0]?.params).toMatchObject({ employeeName: 'inhsub Test', autoApproved: false });
      // decided requests are not announced again
      for (const done of [decided, rejected]) {
        expect(told.some((n) => n.params.requestId === done)).toBe(false);
      }
      // the new manager can decide; the leaver and a stranger cannot
      expect((await decide(mia, pending, 'approve')).status).toBe(403);
      expect((await decide(boss, pending, 'approve')).status).toBe(401);
      expect((await decide(acme.admin, pending, 'approve')).status).toBe(200);
    });

    it('tells HR and Admin when the new manager is nobody', async () => {
      const top = await mkPerson('inhtop', 'manager', adminEmployeeId);
      const low = await mkPerson('inhlow', 'employee', top.employeeId);
      expect((await manage(acme, top.employeeId, null)).status).toBe(204);
      const id = (await request(low, annual, freshWeek(low))).body.id as string;
      expect((await deactivate(top.employeeId)).status).toBe(200);
      for (const who of [hr, acme.admin]) {
        expect(
          (await notificationsOf(who)).some(
            (n) => n.type === 'leave.requested' && n.params.requestId === id,
          ),
        ).toBe(true);
      }
      expect((await notificationsOf(low)).some((n) => n.params.requestId === id)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('tenant isolation', () => {
    it('keeps requests, balances and types of one workspace away from another', async () => {
      const id = (await request(dan, annual, freshWeek(dan))).body.id as string;
      const g = globex.admin;
      const own = (await g.agent.get('/api/v1/employees/me')).body.id as string;
      for (const res of await Promise.all([
        decide(g, id, 'approve'),
        decide(g, id, 'reject'),
        decide(g, id, 'cancel'),
      ])) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      expect((await balance(g, dan.employeeId)).status).toBe(404);
      const adjust = await g.agent
        .post('/api/v1/leave/balances/adjustments')
        .send({ employeeId: dan.employeeId, leaveTypeId: annual, year: 2026, delta: 5 });
      expect(adjust.status).toBe(404);
      expect(
        (await g.agent.patch(`/api/v1/leave/types/${annual}`).send({ isActive: false })).status,
      ).toBe(404);
      const list = leaveRequestListSchema.parse(
        (await g.agent.get('/api/v1/leave/requests').query({ pageSize: 100 })).body,
      );
      expect(list.items.some((r) => r.id === id)).toBe(false);
      // a request of globex's admin for acme's type id is refused
      const cross = await request({ ...g, employeeId: own } as Person, annual, freshWeek());
      expect([cross.status, errorBody(cross).code]).toEqual([400, 'VALIDATION_FAILED']);
      expect((await system.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe(
        'pending',
      );
    });

    it('has its own types, settings and holidays per workspace', async () => {
      const g = globex.admin;
      const types = (await g.agent.get('/api/v1/leave/types')).body as { id: string }[];
      expect(types).toHaveLength(4);
      expect(types.some((t) => t.id === annual)).toBe(false);
      await hr.agent.put('/api/v1/leave/settings').send({ hideSickTypeFromTeam: true });
      expect((await g.agent.get('/api/v1/leave/settings')).body.hideSickTypeFromTeam).toBe(false);
      await hr.agent.put('/api/v1/leave/settings').send({ hideSickTypeFromTeam: false });
    });

    it('is enforced by the database for every leave table', async () => {
      const row = await system.leaveRequest.findFirstOrThrow({
        where: { tenantId: acme.tenantId },
      });
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.leaveRequest.findUnique({ where: { id: row.id } }),
        ),
      ).toBeNull();
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.leaveRequest.updateMany({ where: { id: row.id }, data: { status: 'approved' } }),
        ),
      ).toEqual({ count: 0 });
      expect(
        await asTenant(globex.tenantId, (tx) => tx.leaveType.findMany({ where: { id: annual } })),
      ).toEqual([]);
      await expect(
        asTenant(globex.tenantId, (tx) =>
          tx.leaveRequest.create({
            data: {
              tenantId: acme.tenantId,
              employeeId: dan.employeeId,
              leaveTypeId: annual,
              startDate: new Date('2030-01-07'),
              endDate: new Date('2030-01-07'),
              days: 1,
            },
          }),
        ),
      ).rejects.toThrow();
      await expect(
        system.leaveRequest.create({
          data: {
            tenantId: globex.tenantId,
            employeeId: dan.employeeId,
            leaveTypeId: annual,
            startDate: new Date('2030-01-07'),
            endDate: new Date('2030-01-07'),
            days: 1,
          },
        }),
      ).rejects.toThrow(); // composite foreign keys: no mixing of workspaces
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('database safety nets', () => {
    const base = () => ({
      tenantId: acme.tenantId,
      employeeId: gus.employeeId,
      leaveTypeId: annual,
      startDate: new Date('2031-03-03'),
      endDate: new Date('2031-03-04'),
      days: 2,
    });

    it('refuses overlapping active requests even when the application is bypassed, but not cancelled ones', async () => {
      const first = await system.leaveRequest.create({ data: base() });
      await expect(
        system.leaveRequest.create({
          data: { ...base(), startDate: new Date('2031-03-04'), endDate: new Date('2031-03-05') },
        }),
      ).rejects.toThrow(/leave_request_no_overlap|exclusion/);
      await system.leaveRequest.update({ where: { id: first.id }, data: { status: 'cancelled' } });
      await expect(system.leaveRequest.create({ data: base() })).resolves.toBeTruthy();
    });

    it.each([
      ['an unknown status', { status: 'maybe' }],
      ['an end before the start', { endDate: new Date('2031-02-01') }],
      ['zero days', { days: 0 }],
      ['quarter days', { days: 1.25 }],
      [
        'a half day on both ends of one day',
        { endDate: new Date('2031-03-03'), halfDayStart: true, halfDayEnd: true, days: 0.5 },
      ],
      ['a reason over 300 characters', { reason: 'x'.repeat(301) }],
    ])('refuses %s', async (_label, data) => {
      await expect(
        system.leaveRequest.create({
          data: {
            ...base(),
            startDate: new Date('2032-05-03'),
            endDate: new Date('2032-05-04'),
            ...data,
          },
        }),
      ).rejects.toThrow();
    });

    it('lets the application role neither delete requests nor rewrite counted days and decisions', async () => {
      await expect(
        asTenant(acme.tenantId, (tx) => tx.$executeRaw`DELETE FROM leave_request`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asTenant(
          acme.tenantId,
          (tx) => tx.$executeRaw`UPDATE leave_request_day SET fraction = 0.5`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asTenant(acme.tenantId, (tx) => tx.$executeRaw`DELETE FROM leave_approval`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asTenant(
          acme.tenantId,
          (tx) => tx.$executeRaw`UPDATE leave_approval SET decision = 'approved'`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asTenant(acme.tenantId, (tx) => tx.$executeRaw`DELETE FROM leave_type`),
      ).rejects.toThrow(/permission denied/);
    });

    it('refuses invalid types, policies and holidays', async () => {
      const t = acme.tenantId;
      await expect(
        system.leaveType.create({ data: { tenantId: t, key: 'annual' } }),
      ).rejects.toThrow(); // second annual
      await expect(
        system.leaveType.create({ data: { tenantId: t, key: 'weird' } }),
      ).rejects.toThrow();
      await expect(system.leaveType.create({ data: { tenantId: t, name: ' ' } })).rejects.toThrow();
      await expect(
        system.leaveType.create({ data: { tenantId: t, key: 'unpaid', name: 'Both' } }),
      ).rejects.toThrow();
      await expect(
        system.leaveType.create({ data: { tenantId: t, name: 'Hex', color: '#ff0000' } }),
      ).rejects.toThrow();
      await expect(
        system.leavePolicy.update({
          where: { tenantId_leaveTypeId: { tenantId: t, leaveTypeId: annual } },
          data: { annualAllowanceDays: 400 },
        }),
      ).rejects.toThrow();
      await expect(
        system.holiday.create({
          data: { tenantId: t, date: new Date('2031-01-01'), name: 'x', country: 'de' },
        }),
      ).rejects.toThrow();
    });
  });
});
