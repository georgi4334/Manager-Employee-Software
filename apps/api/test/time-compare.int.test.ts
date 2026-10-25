import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  assignmentSchema,
  compareSchema,
  employeeSchema,
  projectDetailSchema,
  todayIn,
  weekStartOf,
  weekday,
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

describe.skipIf(!urls)('attendance versus logged time over HTTP (real database)', () => {
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
  let mia: Person; // manager of everybody made by fresh()
  let ron: Person; // manager without authority over them
  let project: { id: string };
  let people = 0;

  const today = todayIn(ZONE);
  // The most recent weekday before today: inside the 7 days people may type in themselves.
  const day = (() => {
    let d = addDays(today, -1);
    while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, -1);
    return d;
  })();
  const weekStart = weekStartOf(day);

  async function onboard(ws: Workspace, name: string, role: SystemRole = 'employee') {
    const email = `${name}@${ws === acme ? 'acme' : 'globex'}.eu`;
    const res = await ws.admin.agent
      .post(`${api}/employees`)
      .send({ firstName: name, lastName: 'Test', employmentType: 'full_time', email });
    expect(res.status).toBe(201);
    const who = await accept(email);
    if (role !== 'employee') {
      const set = await ws.admin.agent
        .put(`${api}/users/${who.id}/roles`)
        .send({ roleIds: [ws.roleIds[role]] });
      expect(set.status).toBe(200);
    }
    return { ...who, employeeId: employeeSchema.parse(res.body).id };
  }
  /** A fresh employee under mia, staffed on the project: one scenario's own day. */
  async function fresh(): Promise<Person> {
    const who = await onboard(acme, `p${++people}`);
    const manage = await acme.admin.agent
      .put(`${api}/org/employees/${who.employeeId}/assignment`)
      .send({ managerId: mia.employeeId, departmentId: null });
    expect(manage.status).toBe(204);
    const staffed = await hr.agent.post(`${api}/projects/${project.id}/assignments`).send({
      employeeId: who.employeeId,
      allocationPct: 10,
      fromDate: addDays(today, -200),
    });
    expect(staffed.status, JSON.stringify(staffed.body)).toBe(201);
    assignmentSchema.parse(staffed.body);
    return who;
  }
  const present = async (who: Member, startTime: string, endTime: string, date = day) => {
    const res = await who.agent
      .post(`${api}/attendance/records`)
      .send({ date, startTime, endTime, mode: 'office' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  };
  const logged = async (who: Member, minutes: number, workDate = day) => {
    const res = await who.agent
      .post(`${api}/time/entries`)
      .send({ projectId: project.id, workDate, minutes });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  };
  const compare = (who: Member, query: object = {}) =>
    who.agent.get(`${api}/time/compare`).query({ weekStart, ...query });
  const dayOf = async (who: Member, query: object = {}) => {
    const res = await compare(who, query);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const week = compareSchema.parse(res.body);
    expect(week.weekStart).toBe(weekStart);
    expect(week.days).toHaveLength(7);
    return week.days.find((d) => d.date === day)!;
  };

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    await system.tenant.update({ where: { id: acme.tenantId }, data: { defaultTimezone: ZONE } });
    hr = await onboard(acme, 'hrx', 'hr');
    mia = await onboard(acme, 'mia', 'manager');
    ron = await onboard(acme, 'ron', 'manager');
    const created = await hr.agent.post(`${api}/projects`).send({
      code: 'CMP-1',
      name: 'Compare',
      startDate: addDays(today, -300),
      status: 'active',
      leadEmployeeId: hr.employeeId,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    project = projectDetailSchema.parse(created.body);
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  describe('the flags', () => {
    it('has nothing to say when presence and time agree', async () => {
      const p = await fresh();
      await present(p, '09:00', '17:00');
      await logged(p, 480);
      expect(await dayOf(p)).toMatchObject({
        attendanceMinutes: 480,
        loggedMinutes: 480,
        onLeave: false,
        openRecord: false,
        flag: 'none',
      });
    });

    it('flags more time than presence, and more presence than time', async () => {
      const more = await fresh();
      await present(more, '09:00', '13:00');
      await logged(more, 480);
      expect(await dayOf(more)).toMatchObject({ attendanceMinutes: 240, flag: 'more_logged' });
      const less = await fresh();
      await present(less, '09:00', '17:00');
      await logged(less, 120);
      expect(await dayOf(less)).toMatchObject({ loggedMinutes: 120, flag: 'less_logged' });
    });

    it('allows a difference up to the tolerance of 30 minutes', async () => {
      const within = await fresh();
      await present(within, '09:00', '17:00');
      await logged(within, 510);
      expect((await dayOf(within)).flag).toBe('none');
      const over = await fresh();
      await present(over, '09:00', '17:00');
      await logged(over, 511);
      expect((await dayOf(over)).flag).toBe('more_logged');
    });

    it('adds up several records and entries of the day', async () => {
      const p = await fresh();
      await present(p, '08:00', '12:00');
      await present(p, '13:00', '17:00');
      await logged(p, 200);
      await logged(p, 280);
      expect(await dayOf(p)).toMatchObject({
        attendanceMinutes: 480,
        loggedMinutes: 480,
        flag: 'none',
      });
    });

    it('never flags a day of approved leave', async () => {
      const p = await fresh();
      await logged(p, 480);
      const types = (await p.agent.get(`${api}/leave/types`)).body as { id: string; key: string }[];
      const request = await p.agent.post(`${api}/leave/requests`).send({
        leaveTypeId: types.find((t) => t.key === 'unpaid')!.id,
        startDate: day,
        endDate: day,
      });
      expect(request.status, JSON.stringify(request.body)).toBe(201);
      // still pending: flagged, because nothing is approved yet
      expect((await dayOf(p)).flag).toBe('more_logged');
      const approved = await hr.agent
        .post(`${api}/leave/requests/${(request.body as { id: string }).id}/approve`)
        .send({});
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      expect(await dayOf(p)).toMatchObject({ onLeave: true, flag: 'none' });
    });

    it('never flags a day with a record that is still open', async () => {
      const p = await fresh();
      const open = await p.agent.post(`${api}/attendance/check-in`).send({ mode: 'office' });
      expect(open.status, JSON.stringify(open.body)).toBe(201);
      await logged(p, 120, today);
      const res = await compare(p, { weekStart: today });
      const todays = compareSchema.parse(res.body).days.find((d) => d.date === today)!;
      expect(todays).toMatchObject({
        openRecord: true,
        attendanceMinutes: 0,
        loggedMinutes: 120,
        flag: 'none',
      });
    });

    it('does not count a running timer, and other weeks are separate', async () => {
      const p = await fresh();
      await logged(p, 60, addDays(day, -7));
      await present(p, '09:00', '10:00');
      expect(await dayOf(p)).toMatchObject({ loggedMinutes: 0, attendanceMinutes: 60 });
      const earlier = compareSchema.parse(
        (await compare(p, { weekStart: addDays(weekStart, -7) })).body,
      );
      expect(earlier.days.reduce((s, d) => s + d.loggedMinutes, 0)).toBe(60);
    });

    it('is a week of seven days starting on Monday, for any date in it', async () => {
      const p = await fresh();
      const week = compareSchema.parse(
        (await compare(p, { weekStart: addDays(weekStart, 3) })).body,
      );
      expect(week.weekStart).toBe(weekStart);
      expect(week.days.map((d) => d.date)[0]).toBe(weekStart);
    });
  });

  describe('who may look', () => {
    it('gives people their own week, and their manager and HR the same', async () => {
      const p = await fresh();
      await present(p, '09:00', '17:00');
      await logged(p, 480);
      for (const who of [p, mia, hr, acme.admin]) {
        const d = await dayOf(who, who === p ? {} : { employeeId: p.employeeId });
        expect(d.attendanceMinutes).toBe(480);
      }
    });

    it('is not for colleagues, managers without authority, other workspaces or strangers', async () => {
      const p = await fresh();
      const colleague = await fresh();
      for (const who of [colleague, ron, globex.admin]) {
        const res = await compare(who, { employeeId: p.employeeId });
        expect([res.status, errorBody(res).code], who.email).toEqual([404, 'NOT_FOUND']);
      }
      expect((await compare(hr, { employeeId: UNKNOWN })).status).toBe(404);
      expect((await compare(hr, { employeeId: 'x' })).status).toBe(400);
      expect((await compare(hr, { weekStart: 'x' })).status).toBe(400);
      expect((await compare(globex.admin, { employeeId: p.employeeId })).status).toBe(404);
    });

    it('needs both attendance and time permissions', async () => {
      const p = await fresh();
      const make = async (name: string, codes: string[]) => {
        const who = await onboard(acme, name);
        const role = await system.role.create({
          data: {
            tenantId: acme.tenantId,
            name,
            permissions: {
              create: codes.map((permissionCode) => ({ permissionCode, scope: 'all' })),
            },
          },
        });
        const granted = await acme.admin.agent
          .put(`${api}/users/${who.id}/roles`)
          .send({ roleIds: [role.id] });
        expect(granted.status, JSON.stringify(granted.body)).toBe(200);
        return who;
      };
      const timeOnly = await make('timeonly', ['time.view']);
      const attendanceOnly = await make('attendanceonly', ['attendance.view']);
      const both = await make('both', ['time.view', 'attendance.view']);
      for (const who of [timeOnly, attendanceOnly]) {
        expect((await compare(who, { employeeId: p.employeeId })).status, who.email).toBe(404);
        expect((await compare(who)).status, who.email).toBe(404); // not even their own week
      }
      expect((await compare(both, { employeeId: p.employeeId })).status).toBe(200);
    });
  });
});
