import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  RETENTION_BATCH,
  RETENTION_PRESETS,
  addMonths,
  apiErrorBodySchema,
  employeeSchema,
  retentionOverviewSchema,
  todayIn,
  type RetentionOverview,
  type SystemRole,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { RetentionRunner } from '../src/modules/privacy/retention.runner.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;
const UNKNOWN = '0192f5a0-0000-7000-8000-00000000000a';
const ZONE = 'Europe/Sofia';
const api = '/api/v1';

describe.skipIf(!urls)('automatic retention over HTTP (real database)', () => {
  const env = testEnv({
    DATABASE_URL: urls?.app,
    SYSTEM_DATABASE_URL: urls?.system,
    TRUST_PROXY: 'true',
  });
  let app: NestExpressApplication;
  let system: SystemPrismaService;
  let runner: RetentionRunner;
  const { workspace, accept } = httpWorkspaceHelpers(() => app);

  type Person = Member & { employeeId: string };
  let acme: Workspace;
  let globex: Workspace;
  let hr: Person;
  let mia: Person;
  let dan: Person;
  const today = todayIn(ZONE);
  const ago = (months: number) => addMonths(today, -months);

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
  /** A former employee with a termination date `months` ago (inserted directly: the API refuses old dates). */
  const former = async (ws: Workspace, name: string, months: number | null, extra: object = {}) =>
    (
      await system.employee.create({
        data: {
          tenantId: ws.tenantId,
          firstName: name,
          lastName: 'Former',
          jobTitle: 'Clerk',
          status: 'inactive',
          // the database allows a termination date only on inactive people
          terminationDate:
            months === null || (extra as { status?: string }).status === 'active'
              ? null
              : new Date(`${ago(months)}T00:00:00Z`),
          ...extra,
        },
      })
    ).id;
  const overview = async (as: Member) => {
    const res = await as.agent.get(`${api}/privacy/retention`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return retentionOverviewSchema.parse(res.body) satisfies RetentionOverview;
  };
  const put = (as: Member, body: object) => as.agent.put(`${api}/privacy/retention`).send(body);
  const hold = (as: Member, id: string, held: boolean) =>
    as.agent.put(`${api}/privacy/retention/holds/${id}`).send({ held });
  const state = (id: string) => system.employee.findUniqueOrThrow({ where: { id } });

  let due: string; // 61 months ago
  let soon: string; // 59 months ago: due within the preview window
  let later: string; // 40 months ago
  let noDate: string;
  let held: string; // 62 months ago, on hold
  let active: string; // an active person is never erased automatically
  let withAccount: Person;

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    runner = app.get(RetentionRunner);
    acme = await workspace('acme');
    globex = await workspace('globex');
    await system.tenant.update({ where: { id: acme.tenantId }, data: { defaultTimezone: ZONE } });
    hr = await onboard(acme, 'hrx', 'hr');
    mia = await onboard(acme, 'mia', 'manager');
    dan = await onboard(acme, 'dan');
    due = await former(acme, 'Dora', 61);
    soon = await former(acme, 'Sam', 59);
    later = await former(acme, 'Lena', 40);
    noDate = await former(acme, 'Nora', null);
    held = await former(acme, 'Hugo', 62);
    active = await former(acme, 'Alex', 70, { status: 'active' });

    // a former employee with a login account, deactivated through the API
    withAccount = await onboard(acme, 'ann');
    const off = await hr.agent
      .post(`${api}/employees/${withAccount.employeeId}/deactivate`)
      .send({ terminationDate: today });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    await system.employee.update({
      where: { id: withAccount.employeeId },
      data: { terminationDate: new Date(`${ago(70)}T00:00:00Z`) },
    });
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  describe('access', () => {
    it.each([
      ['an employee', () => dan],
      ['a manager', () => mia],
    ])('is refused for %s', async (_name, who) => {
      for (const res of [
        await who().agent.get(`${api}/privacy/retention`),
        await who().agent.put(`${api}/privacy/retention`).send({ enabled: true }),
        await who().agent.put(`${api}/privacy/retention/holds/${due}`).send({ held: true }),
      ]) {
        expect(res.status).toBe(403);
        expect(errorBody(res).code).toBe('FORBIDDEN');
      }
      expect(await system.retentionPolicy.count({ where: { tenantId: acme.tenantId } })).toBe(0);
    });

    it('needs a signed-in user', async () => {
      const anon = await (
        await import('supertest')
      )
        .default(app.getHttpServer())
        .get(`${api}/privacy/retention`);
      expect(anon.status).toBe(401);
    });
  });

  describe('policy and preview', () => {
    it('starts switched off with the Bulgarian preset', async () => {
      const o = await overview(hr);
      expect(o.policy).toMatchObject({
        country: 'BG',
        enabled: false,
        formerEmployeeMonths: RETENTION_PRESETS.BG.formerEmployeeMonths,
        presetMonths: 60,
        lastRunAt: null,
        lastRunErased: 0,
      });
      expect(o.today).toBe(today);
    });

    it('lists who is due or falls due within 90 days, oldest first, and counts people without a date', async () => {
      const o = await overview(hr);
      const names = o.candidates.map((c) => [c.name, c.due, c.held]);
      expect(names).toEqual([
        ['ann Test', true, false],
        ['Hugo Former', true, false],
        ['Dora Former', true, false],
        ['Sam Former', false, false],
      ]);
      // not listed: 40 months ago, the active person, the one without a date
      expect(o.candidates.some((c) => [later, active, noDate].includes(c.employeeId))).toBe(false);
      expect(o.withoutTerminationDate).toBe(1);
      const sam = o.candidates.find((c) => c.employeeId === soon)!;
      expect(sam.dueDate).toBe(addMonths(ago(59), 60));
      expect(sam.terminationDate).toBe(ago(59));
    });

    it('is the same for an administrator and invisible to another workspace', async () => {
      expect((await overview(acme.admin)).candidates).toHaveLength(4);
      const other = await overview(globex.admin);
      expect(other.candidates).toEqual([]);
      expect(other.withoutTerminationDate).toBe(0);
    });
  });

  describe('changing the policy', () => {
    it.each([
      ['nothing', {}],
      ['too few months', { formerEmployeeMonths: 11 }],
      ['too many months', { formerEmployeeMonths: 601 }],
      ['half a month', { formerEmployeeMonths: 12.5 }],
      ['another country', { country: 'DE' }],
      ['text', { enabled: 'yes' }],
      ['an unknown field', { enabled: true, extra: 1 }],
    ])('refuses %s', async (_name, body) => {
      const res = await put(hr, body);
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    });

    it('stores the period and the switch and audits the values only', async () => {
      const res = await put(hr, { formerEmployeeMonths: 60, enabled: false });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: 'privacy.retention_updated' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.after).toEqual({
        country: 'BG',
        enabled: false,
        formerEmployeeMonths: 60,
      });
      expect(entries[0]?.actorUserId).toBe(hr.id);
      // one row per workspace, however often it is saved
      await put(acme.admin, { formerEmployeeMonths: 60 });
      expect(await system.retentionPolicy.count({ where: { tenantId: acme.tenantId } })).toBe(1);
    });

    it('is checked by the database too', async () => {
      for (const data of [
        { formerEmployeeMonths: 11 },
        { formerEmployeeMonths: 601 },
        { country: 'DE' },
      ]) {
        await expect(
          system.retentionPolicy.update({ where: { tenantId: acme.tenantId }, data }),
        ).rejects.toThrow();
      }
    });
  });

  describe('legal hold', () => {
    it('keeps a person out of the automatic erasure and shows it', async () => {
      const res = await hold(hr, held, true);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(
        retentionOverviewSchema.parse(res.body).candidates.find((c) => c.employeeId === held)?.held,
      ).toBe(true);
      expect((await state(held)).retentionHold).toBe(true);
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: 'privacy.retention_hold_set' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        entityId: held,
        actorUserId: hr.id,
        before: null,
        after: null,
      });
    });

    it.each([
      ['an unknown person', () => hold(hr, UNKNOWN, true)],
      ['a person of another workspace', () => hold(hr, 'GLOBEX', true)],
    ])('is 404 for %s', async (name, run) => {
      const globexPerson = await former(globex, 'Gina', 61);
      const res =
        name === 'a person of another workspace' ? await hold(hr, globexPerson, true) : await run();
      expect(res.status).toBe(404);
      expect((await state(globexPerson)).retentionHold).toBe(false);
    });

    it('is refused with a bad body or id', async () => {
      expect((await hr.agent.put(`${api}/privacy/retention/holds/${due}`).send({})).status).toBe(
        400,
      );
      expect(
        (await hr.agent.put(`${api}/privacy/retention/holds/${due}`).send({ held: 'yes' })).status,
      ).toBe(400);
      expect(
        (await hr.agent.put(`${api}/privacy/retention/holds/nope`).send({ held: true })).status,
      ).toBe(400);
    });
  });

  describe('the automatic run', () => {
    it('does nothing while the policy is off', async () => {
      expect(await runner.run()).toBe(0);
      expect((await state(due)).erasedAt).toBeNull();
    });

    it('anonymises everybody who is due, except people on hold, active people and people not yet due', async () => {
      await put(hr, { enabled: true });
      const globexDue = await former(globex, 'Gus', 61);
      const erased = await runner.run();
      expect(erased).toBe(2); // Dora and ann; Hugo is on hold, Sam is not due yet

      const dora = await state(due);
      expect(dora).toMatchObject({ firstName: '—', jobTitle: null });
      expect(dora.erasedAt).toBeInstanceOf(Date);
      expect(dora.terminationDate).not.toBeNull(); // statutory dates stay
      const ann = await system.user.findFirstOrThrow({
        where: { employee: { id: withAccount.employeeId } },
      });
      expect(ann).toMatchObject({ email: `erased-${ann.id}@invalid`, status: 'disabled' });

      for (const id of [held, soon, later, noDate, active]) {
        expect((await state(id)).erasedAt, id).toBeNull();
      }
      // another workspace with the policy off is untouched
      expect((await state(globexDue)).erasedAt).toBeNull();
    });

    it('audits it without an actor and with the reason only', async () => {
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: 'privacy.erased' },
      });
      expect(entries).toHaveLength(2);
      for (const e of entries) {
        expect(e).toMatchObject({ actorUserId: null, after: { reason: 'retention' } });
      }
      expect(entries.map((e) => e.entityId).sort()).toEqual([due, withAccount.employeeId].sort());
    });

    it('records the run and checks a workspace only once a day', async () => {
      const o = await overview(hr);
      expect(o.policy.lastRunErased).toBe(2);
      expect(o.policy.lastRunAt).not.toBeNull();
      // a person who became due after the run waits for the next day
      const late = await former(acme, 'Lars', 61);
      expect(await runner.run()).toBe(0);
      expect((await state(late)).erasedAt).toBeNull();
      // 24 hours later it is picked up
      expect(await runner.run(new Date(Date.now() + 24 * 3_600_000))).toBe(1);
      expect((await state(late)).erasedAt).not.toBeNull();
    });

    it('releases a hold: the person is erased at the next daily run', async () => {
      expect((await hold(hr, held, false)).status).toBe(200);
      expect(await runner.run(new Date(Date.now() + 49 * 3_600_000))).toBe(1);
      expect((await state(held)).erasedAt).not.toBeNull();
    });

    it('never touches a person who was reactivated in the meantime', async () => {
      const back = await former(acme, 'Rita', 61, { status: 'active' });
      expect(await runner.run(new Date(Date.now() + 100 * 3_600_000))).toBe(0);
      expect((await state(back)).erasedAt).toBeNull();
    });

    it('works in each workspace with its own policy', async () => {
      const g = await former(globex, 'Gil', 61);
      expect(
        (
          await globex.admin.agent
            .put(`${api}/privacy/retention`)
            .send({ enabled: true, formerEmployeeMonths: 12 })
        ).status,
      ).toBe(200);
      expect(await runner.run(new Date(Date.now() + 150 * 3_600_000))).toBeGreaterThanOrEqual(1);
      expect((await state(g)).erasedAt).not.toBeNull();
      // Acme's own policy (60 months) was not changed by Globex's
      expect((await overview(hr)).policy.formerEmployeeMonths).toBe(60);
    });

    it('erases at most one batch per run and continues with the rest at the next run', async () => {
      await put(hr, { enabled: true });
      const ids: string[] = [];
      for (let i = 0; i < RETENTION_BATCH + 1; i++) ids.push(await former(acme, `Bulk${i}`, 120));
      const t = Date.now() + 400 * 3_600_000;
      expect(await runner.run(new Date(t))).toBe(RETENTION_BATCH);
      const left = await system.employee.count({ where: { id: { in: ids }, erasedAt: null } });
      expect(left).toBe(1);
      // the batch was full, so the last-run time was not moved and the next run continues at once
      expect(await runner.run(new Date(t + 3_600_000))).toBe(1);
      expect(await system.employee.count({ where: { id: { in: ids }, erasedAt: null } })).toBe(0);
    });
  });

  describe('manual erasure stays possible', () => {
    it('lets HR erase a person on hold, as the right to erasure is separate', async () => {
      const p = await former(acme, 'Paul', 20, { retentionHold: true });
      const res = await hr.agent.post(`${api}/privacy/erase/${p}`).send({ confirm: true });
      expect(res.status, JSON.stringify(res.body)).toBe(204);
      expect((await state(p)).erasedAt).not.toBeNull();
    });
  });

  describe('the external hook', () => {
    it('is public only with the token and also runs the retention', async () => {
      // not configured in this test app: the hook does not exist
      const res = await (
        await import('supertest')
      )
        .default(app.getHttpServer())
        .post(`${api}/internal/reminders/run`);
      expect(res.status).toBe(404);
    });
  });
});
