import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiErrorBodySchema, employeeSchema, todayIn } from '@intime/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { OutboxWorker } from '../src/modules/notifications/delivery/outbox-worker.service.js';
import { RemindersService } from '../src/modules/notifications/delivery/reminders.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;
const api = '/api/v1';
const HOUR = 3_600_000;
const TOKEN = 'reminder-token-that-is-at-least-32-characters-long';

describe.skipIf(!urls)('reminders over HTTP (real database)', () => {
  const env = testEnv({
    DATABASE_URL: urls?.app,
    SYSTEM_DATABASE_URL: urls?.system,
    TRUST_PROXY: 'true',
    REMINDERS_TOKEN: TOKEN,
  });
  let app: NestExpressApplication;
  let system: SystemPrismaService;
  const { workspace, accept } = httpWorkspaceHelpers(() => app);

  type Person = Member & { employeeId: string };
  let acme: Workspace;
  let globex: Workspace;
  let people = 0;
  const now = () => new Date();
  const ago = (hours: number) => new Date(Date.now() - hours * HOUR);
  const reminders = () => app.get(RemindersService);

  async function onboard(ws: Workspace): Promise<Person> {
    const name = `r${++people}`;
    const email = `${name}@${ws === acme ? 'acme' : 'globex'}.eu`;
    const res = await ws.admin.agent
      .post(`${api}/employees`)
      .send({ firstName: name, lastName: 'Test', employmentType: 'full_time', email });
    expect(res.status).toBe(201);
    const who = await accept(email);
    return { ...who, employeeId: employeeSchema.parse(res.body).id };
  }
  const openRecord = (ws: Workspace, who: Person, hoursAgo: number, extra: object = {}) =>
    system.attendanceRecord.create({
      data: {
        tenantId: ws.tenantId,
        employeeId: who.employeeId,
        workDate: new Date(`${todayIn('UTC', ago(hoursAgo))}T00:00:00Z`),
        checkInAt: ago(hoursAgo),
        mode: 'office',
        ...extra,
      },
    });
  const timer = (ws: Workspace, who: Person, hoursAgo: number) =>
    system.timeEntry.create({
      data: {
        tenantId: ws.tenantId,
        employeeId: who.employeeId,
        projectId: project[ws === acme ? 'acme' : 'globex']!,
        workDate: new Date(`${todayIn('UTC', ago(hoursAgo))}T00:00:00Z`),
        source: 'timer',
        startedAt: ago(hoursAgo),
        minutes: null,
      },
    });
  const project: { acme?: string; globex?: string } = {};
  const notesOf = async (who: Member) => {
    await app.get(OutboxWorker).runOnce();
    const items = (await who.agent.get(`${api}/notifications`)).body.items as {
      type: string;
      params: Record<string, unknown>;
    }[];
    return items.filter((n) => n.type.endsWith('reminder'));
  };

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    for (const [key, ws] of [
      ['acme', acme],
      ['globex', globex],
    ] as const) {
      const created = await system.project.create({
        data: {
          tenantId: ws.tenantId,
          code: 'REM-1',
          name: 'Reminders',
          startDate: new Date('2026-01-01T00:00:00Z'),
          status: 'active',
        },
      });
      project[key] = created.id;
    }
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  describe('forgotten check-outs', () => {
    it('tells the owner once, with the day only', async () => {
      const p = await onboard(acme);
      const record = await openRecord(acme, p, 13);
      const stats = await reminders().run(now());
      expect(stats.attendance).toBeGreaterThanOrEqual(1);
      const notes = await notesOf(p);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ type: 'attendance.reminder' });
      expect(Object.keys(notes[0]!.params)).toEqual(['date']);
      expect(
        (await system.attendanceRecord.findUniqueOrThrow({ where: { id: record.id } })).remindedAt,
      ).not.toBeNull();
      await reminders().run(now()); // a second run says nothing more
      expect(await notesOf(p)).toHaveLength(1);
    });

    it('waits for twelve hours, and then speaks', async () => {
      const p = await onboard(acme);
      await openRecord(acme, p, 11.9);
      await reminders().run(now());
      expect(await notesOf(p)).toHaveLength(0);
      await reminders().run(new Date(Date.now() + 0.2 * HOUR));
      expect(await notesOf(p)).toHaveLength(1);
    });

    it('leaves finished records alone', async () => {
      const p = await onboard(acme);
      await openRecord(acme, p, 20, { checkOutAt: ago(10) });
      await reminders().run(now());
      expect(await notesOf(p)).toHaveLength(0);
    });

    it('marks but does not notify an inactive employee, so the sweep does not repeat itself', async () => {
      const p = await onboard(acme);
      const record = await openRecord(acme, p, 14);
      await system.employee.update({ where: { id: p.employeeId }, data: { status: 'inactive' } });
      await reminders().run(now());
      expect(await notesOf(p)).toHaveLength(0);
      expect(
        (await system.attendanceRecord.findUniqueOrThrow({ where: { id: record.id } })).remindedAt,
      ).not.toBeNull();
    });
  });

  describe('timers left running', () => {
    it('tells the owner once after ten hours', async () => {
      const p = await onboard(acme);
      await timer(acme, p, 9.9);
      await reminders().run(now());
      expect(await notesOf(p)).toHaveLength(0);
      await reminders().run(new Date(Date.now() + 0.2 * HOUR));
      const notes = await notesOf(p);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ type: 'time.timer_reminder' });
      expect(Object.keys(notes[0]!.params)).toEqual(['date']);
      await reminders().run(new Date(Date.now() + 5 * HOUR));
      expect(await notesOf(p)).toHaveLength(1);
    });

    it('does not notify an inactive employee about a timer either', async () => {
      const p = await onboard(acme);
      const entry = await timer(acme, p, 12);
      await system.employee.update({ where: { id: p.employeeId }, data: { status: 'inactive' } });
      await reminders().run(now());
      expect(await notesOf(p)).toHaveLength(0);
      expect(
        (await system.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })).remindedAt,
      ).not.toBeNull();
    });

    it('ignores stopped timers and manual entries', async () => {
      const p = await onboard(acme);
      await system.timeEntry.create({
        data: {
          tenantId: acme.tenantId,
          employeeId: p.employeeId,
          projectId: project.acme!,
          workDate: new Date('2026-10-20T00:00:00Z'),
          source: 'timer',
          startedAt: ago(30),
          endedAt: ago(29),
          minutes: 60,
        },
      });
      await system.timeEntry.create({
        data: {
          tenantId: acme.tenantId,
          employeeId: p.employeeId,
          projectId: project.acme!,
          workDate: new Date('2026-10-20T00:00:00Z'),
          source: 'manual',
          minutes: 60,
        },
      });
      await reminders().run(now());
      expect(await notesOf(p)).toHaveLength(0);
    });
  });

  describe('workspaces and races', () => {
    it('reminds each workspace about its own people only', async () => {
      const a = await onboard(acme);
      const g = await onboard(globex);
      await openRecord(acme, a, 13);
      await openRecord(globex, g, 13);
      await reminders().run(now());
      expect(await notesOf(a)).toHaveLength(1);
      expect(await notesOf(g)).toHaveLength(1);
      const stranger = await onboard(globex);
      expect(await notesOf(stranger)).toHaveLength(0);
    });

    it('sends one reminder when two runs overlap', async () => {
      const p = await onboard(acme);
      await openRecord(acme, p, 15);
      await timer(acme, p, 12);
      await Promise.all([reminders().run(now()), reminders().run(now())]);
      const notes = await notesOf(p);
      expect(notes.map((n) => n.type).sort()).toEqual([
        'attendance.reminder',
        'time.timer_reminder',
      ]);
    });
  });

  describe('the hook for the external scheduler', () => {
    const call = (headers: Record<string, string> = {}) =>
      request(app.getHttpServer()).post(`${api}/internal/reminders/run`).set(headers);

    it('runs with the right token and says how much it did', async () => {
      const p = await onboard(acme);
      await openRecord(acme, p, 13);
      const res = await call({ Authorization: `Bearer ${TOKEN}` });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toEqual({
        attendance: expect.any(Number),
        timers: expect.any(Number),
        erased: 0,
      });
      expect(await notesOf(p)).toHaveLength(1);
    });

    it.each([
      ['no header', {}],
      ['a wrong token', { Authorization: 'Bearer wrong-token-wrong-token-wrong-token-xx' }],
      ['a token of another length', { Authorization: 'Bearer x' }],
      ['an empty token', { Authorization: 'Bearer ' }],
      ['the token without the scheme', { Authorization: TOKEN }],
      ['another scheme', { Authorization: `Basic ${TOKEN}` }],
    ])('refuses %s', async (_label, headers) => {
      const p = await onboard(acme);
      await openRecord(acme, p, 13);
      const res = await call(headers);
      expect([res.status, errorBody(res).code]).toEqual([401, 'UNAUTHENTICATED']);
      expect(await notesOf(p)).toHaveLength(0); // nothing was sent
    });

    it('does not exist without a configured token', async () => {
      const bare = await createTestApp({
        env: testEnv({
          DATABASE_URL: urls?.app,
          SYSTEM_DATABASE_URL: urls?.system,
          TRUST_PROXY: 'true',
        }),
      });
      try {
        const res = await request(bare.getHttpServer())
          .post(`${api}/internal/reminders/run`)
          .set('Authorization', `Bearer ${TOKEN}`);
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      } finally {
        await bare.close();
      }
    });
  });
});
