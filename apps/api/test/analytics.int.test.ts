import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  analyticsSchema,
  apiErrorBodySchema,
  employeeSchema,
  projectDetailSchema,
  todayIn,
  weekStartOf,
  type Analytics,
  type SystemRole,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;
const ZONE = 'Europe/Sofia';
const api = '/api/v1';

describe.skipIf(!urls)('analytics over HTTP (real database)', () => {
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
  let mia: Person; // manager of dan and eve
  let dan: Person;
  let eve: Person;
  let others: Person[]; // five more people, nobody's report
  let secret: { id: string; code: string }; // a project only HR/Admin can see
  let alpha: { id: string; code: string };

  const today = todayIn(ZONE);
  const mon = addDays(weekStartOf(today), -14);
  const period = { from: mon, to: today };
  const nextTuesday = addDays(weekStartOf(today), 22);
  let counter = 0;

  async function onboard(
    ws: Workspace,
    name: string,
    role: SystemRole = 'employee',
    extra: object = {},
  ) {
    const email = `${name}@${ws === acme ? 'acme' : 'globex'}.eu`;
    const res = await ws.admin.agent
      .post(`${api}/employees`)
      .send({ firstName: name, lastName: 'Test', employmentType: 'full_time', email, ...extra });
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
  const makeProject = async (lead: string, name: string, extra: object = {}) => {
    const res = await hr.agent.post(`${api}/projects`).send({
      code: `A${String(++counter).padStart(3, '0')}`,
      name,
      startDate: addDays(today, -400),
      status: 'active',
      leadEmployeeId: lead,
      ...extra,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return projectDetailSchema.parse(res.body);
  };
  const log = async (who: Member, projectId: string, workDate: string, minutes: number) => {
    const res = await who.agent
      .post(`${api}/time/entries`)
      .send({ projectId, workDate, minutes, isBillable: projectId === alpha.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  };
  const ask = (who: Member, query: object = period) =>
    who.agent.get(`${api}/analytics`).query(query);
  const overview = async (who: Member, query: object = period): Promise<Analytics> => {
    const res = await ask(who, query);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return analyticsSchema.parse(res.body);
  };

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    await system.tenant.update({ where: { id: acme.tenantId }, data: { defaultTimezone: ZONE } });
    hr = await onboard(acme, 'hrx', 'hr');
    mia = await onboard(acme, 'mia', 'manager');
    dan = await onboard(acme, 'dan');
    eve = await onboard(acme, 'eve', 'employee', { hireDate: addDays(mon, 2) });
    others = [];
    for (const name of ['fay', 'gus', 'hal', 'ida', 'jon']) others.push(await onboard(acme, name));
    for (const who of [dan, eve]) {
      const res = await acme.admin.agent
        .put(`${api}/org/employees/${who.employeeId}/assignment`)
        .send({ managerId: mia.employeeId, departmentId: null });
      expect(res.status).toBe(204);
    }

    // Alpha is led by Mia (she sees it), Secret is led by HR and staffs nobody Mia manages.
    alpha = await makeProject(mia.employeeId, 'Alpha', { budgetHours: 3 });
    secret = await makeProject(hr.employeeId, 'Secret', { budgetHours: 1 });
    for (const [project, who] of [
      [alpha.id, dan],
      [alpha.id, eve],
      [secret.id, others[0]!],
    ] as const) {
      const res = await hr.agent
        .post(`${api}/projects/${project}/assignments`)
        .send({ employeeId: who.employeeId, allocationPct: 50, fromDate: addDays(today, -400) });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    await log(dan, alpha.id, mon, 120); // 2 h billable, Alpha: 3 h budget → warning needs 80 %
    await log(eve, alpha.id, addDays(mon, 3), 90); // total on Alpha: 3.5 h → over budget
    await log(others[0]!, secret.id, addDays(mon, 1), 60); // 1 h on Secret → exactly the budget

    // Dan is off for a day (approved) and Eve has a request waiting
    const types = (await dan.agent.get(`${api}/leave/types`)).body as { id: string; key: string }[];
    const unpaid = types.find((t) => t.key === 'unpaid')!.id;
    const leave = await dan.agent
      .post(`${api}/leave/requests`)
      .send({ leaveTypeId: unpaid, startDate: addDays(mon, 2), endDate: addDays(mon, 2) });
    expect(leave.status, JSON.stringify(leave.body)).toBe(201);
    expect(
      (
        await hr.agent
          .post(`${api}/leave/requests/${(leave.body as { id: string }).id}/approve`)
          .send({})
      ).status,
    ).toBe(200);
    const waiting = await eve.agent
      .post(`${api}/leave/requests`)
      .send({ leaveTypeId: unpaid, startDate: nextTuesday, endDate: nextTuesday });
    expect(waiting.status, JSON.stringify(waiting.body)).toBe(201);

    // one finished attendance record of 8 h 30 min for Dan, remote
    const att = await dan.agent.post(`${api}/attendance/records`).send({
      date: addDays(today, -1),
      startTime: '09:00',
      endTime: '17:30',
      mode: 'remote',
    });
    expect(att.status, JSON.stringify(att.body)).toBe(201);

    // an open task past due on Alpha, a done one that must not count
    for (const [title, status, dueDate] of [
      ['Late one', 'todo', addDays(today, -3)],
      ['Done late', 'done', addDays(today, -3)],
      ['Future', 'in_progress', addDays(today, 9)],
    ] as const) {
      const res = await hr.agent
        .post(`${api}/projects/${alpha.id}/tasks`)
        .send({ title, status, dueDate });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  describe('company view (HR)', () => {
    it('counts everybody and adds up the figures', async () => {
      const a = await overview(hr);
      // admin + hrx + mia + dan + eve + five others
      expect(a.population).toBe(10);
      expect(a.people.headcount).toBe(10);
      expect(a.people.hires).toBe(1); // Eve was hired in the period
      expect(a.people.leavers).toBe(0);
      expect(a.absence).toMatchObject({ days: 1, pendingRequests: 1, daysPerPerson: 0.1 });
      expect(a.attendance).toMatchObject({ records: 1, workedMinutes: 510 });
      expect(a.time.loggedMinutes).toBe(120 + 90 + 60);
      expect(a.time.billablePercent).toBe(78); // 210 of 270
      expect(a.time.approvedPercent).toBe(0);
      expect(a.time.weeks).toEqual([
        { weekStart: mon, minutes: 270 },
        { weekStart: addDays(mon, 7), minutes: 0 },
        { weekStart: addDays(mon, 14), minutes: 0 },
      ]);
      expect(a.time.topProjects.map((p) => [p.id, p.minutes])).toEqual([
        [alpha.id, 210],
        [secret.id, 60],
      ]);
    });

    it('shows breakdowns for a group of five or more', async () => {
      const a = await overview(hr);
      expect(a.people.byEmploymentType).toEqual([{ type: 'full_time', count: 10 }]);
      expect(a.people.byDepartment).toEqual([{ id: null, name: null, count: 10 }]);
      expect(a.absence.byType?.map((t) => [t.key, t.days])).toEqual([['unpaid', 1]]);
      expect(a.attendance.byMode).toEqual([{ mode: 'remote', records: 1 }]);
    });

    it('reports tasks and budgets of projects', async () => {
      const a = await overview(hr);
      expect(a.projects.byStatus.find((s) => s.status === 'active')?.count).toBe(2);
      expect(a.projects.openTasks).toBe(2);
      expect(a.projects.overdueTasks).toBe(1);
      expect(a.projects.budgetOver).toBe(1); // Alpha: 3.5 h of 3 h
      expect(a.projects.budgetWarning).toBe(1); // Secret: 1 h of 1 h is 100 %, not above it
    });

    it('adds the company sections', async () => {
      const a = await overview(hr);
      expect(a.company).not.toBeNull();
      expect(a.company?.goals.byStatus.map((g) => g.count)).toEqual([0, 0, 0, 0]);
      expect(a.company?.reviews).toBeNull();
    });

    it('counts a finished approved week as approved hours', async () => {
      const sub = await dan.agent.post(`${api}/time/timesheets/submit`).send({ weekStart: mon });
      expect(sub.status, JSON.stringify(sub.body)).toBeLessThan(300);
      const sheets = await mia.agent.get(`${api}/time/timesheets`).query({ status: 'submitted' });
      const sheet = (sheets.body as { items?: { id: string }[] }).items?.[0];
      expect(sheet).toBeDefined();
      const ok = await mia.agent.post(`${api}/time/timesheets/${sheet!.id}/approve`).send({});
      expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300);
      const a = await overview(hr);
      expect(a.time.approvedPercent).toBe(44); // Dan's 120 of 270
    });
  });

  describe('a manager sees only their team', () => {
    it('limits the population and withholds breakdowns of a small group', async () => {
      const a = await overview(mia);
      expect(a.population).toBe(3); // Mia, Dan, Eve
      expect(a.people.headcount).toBe(3);
      expect(a.people.byDepartment).toBeNull();
      expect(a.people.byEmploymentType).toBeNull();
      expect(a.absence.byType).toBeNull();
      expect(a.attendance.byMode).toBeNull();
      // totals stay: Dan's day off, Dan's attendance
      expect(a.absence.days).toBe(1);
      expect(a.attendance.records).toBe(1);
    });

    it('counts only the time of the people in scope and the projects they may see', async () => {
      const a = await overview(mia);
      expect(a.time.loggedMinutes).toBe(120 + 90); // not the 60 minutes of someone else
      expect(a.time.topProjects.map((p) => p.id)).toEqual([alpha.id]);
      expect(a.projects.byStatus.find((s) => s.status === 'active')?.count).toBe(1);
      expect(a.projects.budgetOver).toBe(1);
      expect(a.projects.budgetWarning).toBe(0);
    });

    it('does not get the company sections', async () => {
      expect((await overview(mia)).company).toBeNull();
    });
  });

  describe('permissions and input', () => {
    it('refuses an employee and an anonymous caller', async () => {
      const res = await ask(dan);
      expect(res.status).toBe(403);
      expect(errorBody(res).code).toBe('FORBIDDEN');
      const anon = await ask({
        agent: (await import('supertest')).default(app.getHttpServer()),
      } as Member);
      expect(anon.status).toBe(401);
    });

    it.each([
      ['inverted', { from: '2026-10-05', to: '2026-10-01' }],
      ['too long', { from: '2025-01-01', to: '2026-12-31' }],
      ['bad date', { from: 'yesterday', to: '2026-10-01' }],
      ['missing', {}],
    ])('refuses a %s period', async (_name, query) => {
      const res = await ask(hr, query);
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    });

    it('accepts a single day and a year', async () => {
      expect((await ask(hr, { from: mon, to: mon })).status).toBe(200);
      expect((await ask(hr, { from: '2026-01-01', to: '2026-12-31' })).status).toBe(200);
    });

    it('returns zeros for a period with nothing in it', async () => {
      const a = await overview(hr, { from: '2020-01-06', to: '2020-01-12' });
      expect(a.absence.days).toBe(0);
      expect(a.time.loggedMinutes).toBe(0);
      expect(a.time.billablePercent).toBeNull();
      expect(a.time.weeks).toEqual([{ weekStart: '2020-01-06', minutes: 0 }]);
      expect(a.attendance.records).toBe(0);
    });
  });

  describe('tenant isolation', () => {
    it("another workspace's data never shows up", async () => {
      const other = await globex.admin.agent.get(`${api}/analytics`).query(period);
      expect(other.status).toBe(200);
      const a = analyticsSchema.parse(other.body);
      expect(a.population).toBe(1);
      expect(a.time.loggedMinutes).toBe(0);
      expect(a.absence.days).toBe(0);
      expect(a.projects.byStatus.every((s) => s.count === 0)).toBe(true);
    });
  });
});
