import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  assignmentSchema,
  employeeSchema,
  exportSchema,
  projectDetailSchema,
  reportSchema,
  taskSchema,
  timesheetSchema,
  todayIn,
  weekStartOf,
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

describe.skipIf(!urls)('time reports over HTTP (real database)', () => {
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
  let mia: Person; // manager: leads P1, manages dan
  let ron: Person; // manager: leads P2
  let dan: Person;
  let eve: Person;
  let gus: Person;
  let ctl: Person; // custom role: all project reports and exports, but may not see clients
  let p1: { id: string; code: string };
  let p2: { id: string; code: string };
  let p3: { id: string; code: string }; // led by HR, no client

  const today = todayIn(ZONE);
  const weekA = addDays(weekStartOf(today), -14);
  const range = { from: weekA, to: addDays(weekA, 6) };
  let counter = 0;

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
  const makeProject = async (lead: string, name: string, extra: object = {}) => {
    const res = await hr.agent.post(`${api}/projects`).send({
      code: `R${String(++counter).padStart(3, '0')}`,
      name,
      startDate: addDays(today, -400),
      status: 'active',
      leadEmployeeId: lead,
      ...extra,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return projectDetailSchema.parse(res.body);
  };
  const staff = async (project: string, employeeId: string) => {
    const res = await hr.agent
      .post(`${api}/projects/${project}/assignments`)
      .send({ employeeId, allocationPct: 20, fromDate: addDays(today, -400) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return assignmentSchema.parse(res.body);
  };
  const log = async (
    who: Member,
    projectId: string,
    workDate: string,
    minutes: number,
    extra: object = {},
  ) => {
    const res = await who.agent
      .post(`${api}/time/entries`)
      .send({ projectId, workDate, minutes, ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  };
  const submitAndApprove = async (who: Member, weekStart: string) => {
    const sheet = timesheetSchema.parse(
      (await who.agent.post(`${api}/time/timesheets/submit`).send({ weekStart })).body,
    );
    const res = await hr.agent.post(`${api}/time/timesheets/${sheet.id}/approve`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  const report = (who: Member, query: object) => who.agent.get(`${api}/time/reports`).query(query);
  const reportOf = async (who: Member, groupBy: string, extra: object = {}) => {
    const res = await report(who, { ...range, groupBy, ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return reportSchema.parse(res.body);
  };
  const exportOf = (who: Member, query: object = {}) =>
    who.agent.get(`${api}/time/reports/export`).query({ ...range, ...query });
  const labels = (r: { rows: { label: string }[] }) => r.rows.map((row) => row.label);

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    await system.tenant.update({ where: { id: acme.tenantId }, data: { defaultTimezone: ZONE } });
    hr = await onboard(acme, 'hrx', 'hr');
    mia = await onboard(acme, 'mia', 'manager');
    ron = await onboard(acme, 'ron', 'manager');
    dan = await onboard(acme, 'dan');
    eve = await onboard(acme, 'eve');
    gus = await onboard(acme, 'gus');
    ctl = await onboard(acme, 'ctl');
    const role = await system.role.create({
      data: {
        tenantId: acme.tenantId,
        name: 'Controller',
        permissions: {
          create: [
            { permissionCode: 'time.report_project', scope: 'all' },
            { permissionCode: 'time.export', scope: 'all' },
            { permissionCode: 'time.view', scope: 'all' },
          ],
        },
      },
    });
    const granted = await acme.admin.agent
      .put(`${api}/users/${ctl.id}/roles`)
      .send({ roleIds: [role.id] });
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);
    const manage = await acme.admin.agent
      .put(`${api}/org/employees/${dan.employeeId}/assignment`)
      .send({ managerId: mia.employeeId, departmentId: null });
    expect(manage.status).toBe(204);

    const client = (await hr.agent.post(`${api}/clients`).send({ name: 'Initech' })).body as {
      id: string;
    };
    p1 = await makeProject(mia.employeeId, 'Alpha', { clientId: client.id, budgetHours: 10 });
    p2 = await makeProject(ron.employeeId, 'Beta');
    p3 = await makeProject(hr.employeeId, 'Gamma');
    for (const person of [dan, eve])
      for (const p of [p1, p2, p3]) await staff(p.id, person.employeeId);

    const task = taskSchema.parse(
      (await mia.agent.post(`${api}/projects/${p1.id}/tasks`).send({ title: 'Build' })).body,
    );
    // dan: 3 h on Alpha (one non-billable, with a note and a task), 30 min on Beta; Sunday counts for the week
    await log(dan, p1.id, weekA, 120, { taskId: task.id, note: 'secret note' });
    await log(dan, p1.id, addDays(weekA, 6), 60, { isBillable: false });
    await log(dan, p2.id, addDays(weekA, 1), 30);
    // before the period: counts for "logged so far" but not for the period
    await log(dan, p1.id, addDays(weekA, -21), 30);
    // eve: 90 min on Alpha, never submitted; 45 min on Gamma
    await log(eve, p1.id, addDays(weekA, 2), 90);
    await log(eve, p3.id, addDays(weekA, 2), 45);
    await submitAndApprove(dan, weekA);
    // eve's week waits for a decision: it counts as logged, never as approved, and stays out of the export
    expect(
      (await eve.agent.post(`${api}/time/timesheets/submit`).send({ weekStart: weekA })).status,
    ).toBe(200);
    // a running timer has no minutes: it must not show up
    expect(
      (await gus.agent.post(`${api}/time/timer/start`).send({ projectId: p1.id })).status,
    ).toBeGreaterThanOrEqual(400); // gus is on no project: refused, nothing running
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe('reports per project', () => {
    it('adds up total, billable and approved hours, with budget versus actual', async () => {
      const r = await reportOf(hr, 'project');
      const row = (code: string) => r.rows.find((x) => x.detail === code)!;
      expect(row(p1.code)).toMatchObject({
        label: 'Alpha',
        id: p1.id,
        totalMinutes: 120 + 60 + 90,
        billableMinutes: 120 + 90, // the non-billable hour is left out
        approvedMinutes: 120 + 60, // only dan's week is approved
        budgetMinutes: 600,
        loggedMinutes: 120 + 60 + 90 + 30, // also the entry before the period
      });
      expect(row(p2.code)).toMatchObject({
        totalMinutes: 30,
        approvedMinutes: 30,
        budgetMinutes: null,
        loggedMinutes: 30,
      });
      expect(row(p3.code)).toMatchObject({ totalMinutes: 45, approvedMinutes: 0 });
      expect(r.totalMinutes).toBe(270 + 30 + 45);
      expect(r.billableMinutes).toBe(210 + 30 + 45);
      expect(r.approvedMinutes).toBe(180 + 30);
      expect(r.rows.map((x) => x.totalMinutes)).toEqual([270, 45, 30]); // biggest first
    });

    it('limits the period to the dates asked for, both ends included', async () => {
      const day = await reportOf(hr, 'project', { from: weekA, to: weekA });
      expect(day.rows.map((x) => [x.detail, x.totalMinutes])).toEqual([[p1.code, 120]]);
      const sunday = addDays(weekA, 6);
      const last = await reportOf(hr, 'project', { from: sunday, to: sunday });
      expect(last.rows.map((x) => [x.detail, x.totalMinutes])).toEqual([[p1.code, 60]]);
      const empty = await reportOf(hr, 'project', {
        from: addDays(weekA, 7),
        to: addDays(weekA, 13),
      });
      expect(empty).toMatchObject({ rows: [], totalMinutes: 0 });
    });

    it('can be narrowed to one project', async () => {
      const r = await reportOf(hr, 'project', { projectId: p2.id });
      expect(r.rows.map((x) => x.detail)).toEqual([p2.code]);
      expect((await report(hr, { ...range, groupBy: 'project', projectId: UNKNOWN })).status).toBe(
        404,
      );
    });
  });

  describe('reports per person and per client', () => {
    it('adds up per person, with the project filter', async () => {
      const r = await reportOf(hr, 'person');
      expect(r.rows.map((x) => [x.label, x.totalMinutes])).toEqual([
        ['dan Test', 210],
        ['eve Test', 135],
      ]);
      expect(r.rows[0]).toMatchObject({ id: dan.employeeId, budgetMinutes: null });
      const onAlpha = await reportOf(hr, 'person', { projectId: p1.id });
      expect(onAlpha.rows.map((x) => [x.label, x.totalMinutes])).toEqual([
        ['dan Test', 180],
        ['eve Test', 90],
      ]);
    });

    it('adds up per client, and keeps projects without a client together', async () => {
      const r = await reportOf(hr, 'client');
      expect(r.rows.map((x) => [x.label, x.id === null ? null : 'client', x.totalMinutes])).toEqual(
        [
          ['Initech', 'client', 270],
          ['', null, 75],
        ],
      );
    });
  });

  describe('who sees what', () => {
    it('shows a manager the projects they lead, and nothing of other projects', async () => {
      const r = await reportOf(mia, 'project');
      expect(r.rows.map((x) => x.detail)).toEqual([p1.code]);
      expect(r.totalMinutes).toBe(270);
      expect((await report(mia, { ...range, groupBy: 'project', projectId: p2.id })).status).toBe(
        404,
      );
      expect((await reportOf(ron, 'project')).rows.map((x) => x.detail)).toEqual([p2.code]);
      const clients = await reportOf(mia, 'client');
      expect(labels(clients)).toEqual(['Initech']);
    });

    it('shows a manager the hours of their own people only', async () => {
      const r = await reportOf(mia, 'person');
      expect(labels(r)).toEqual(['dan Test']); // eve does not report to mia
      expect(r.totalMinutes).toBe(210); // dan's time on every project, including Beta
      expect((await reportOf(ron, 'person')).rows).toEqual([]);
      expect(labels(await reportOf(mia, 'person', { projectId: p1.id }))).toEqual(['dan Test']);
      expect((await report(mia, { ...range, groupBy: 'person', projectId: p2.id })).status).toBe(
        404,
      );
    });

    it('keeps clients from people who may not see them, but reports the rest', async () => {
      const res = await report(ctl, { ...range, groupBy: 'client' });
      expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      expect((await reportOf(ctl, 'project')).rows).toHaveLength(3);
      expect((await reportOf(ctl, 'person')).rows).toHaveLength(2);
      expect((await exportOf(ctl)).status).toBe(200);
      // time.view alone (no time.log) is enough to read weeks, but not to write
      const week = await ctl.agent
        .get(`${api}/time/week`)
        .query({ employeeId: dan.employeeId, weekStart: weekA });
      expect(week.status).toBe(200);
      expect((await ctl.agent.get(`${api}/time/week`)).status).toBe(200);
      const write = await ctl.agent
        .post(`${api}/time/entries`)
        .send({ projectId: p1.id, workDate: weekA, minutes: 5 });
      expect(write.status).toBe(403);
    });

    it('gives employees their own hours only, and no project or client reports', async () => {
      for (const groupBy of ['project', 'client']) {
        const res = await report(dan, { ...range, groupBy });
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      }
      const mine = await reportOf(dan, 'person');
      expect(mine.rows.map((x) => [x.id, x.totalMinutes])).toEqual([[dan.employeeId, 210]]);
      expect((await reportOf(gus, 'person')).rows).toEqual([]);
    });

    it('never counts a running timer', async () => {
      const p = await onboard(acme, 'timer');
      await staff(p1.id, p.employeeId);
      expect(
        (await p.agent.post(`${api}/time/timer/start`).send({ projectId: p1.id })).status,
      ).toBe(201);
      const r = await reportOf(hr, 'project', { from: today, to: today });
      expect(r.rows).toEqual([]);
    });
  });

  describe('input', () => {
    it.each([
      ['no grouping', {}],
      ['an unknown grouping', { groupBy: 'team' }],
      ['an end before the start', { groupBy: 'project', from: '2026-10-31', to: '2026-10-01' }],
      ['a bad date', { groupBy: 'project', from: 'x' }],
      ['more than a year', { groupBy: 'project', from: '2024-01-01', to: '2026-01-01' }],
      ['a bad project id', { groupBy: 'project', projectId: 'x' }],
    ])('refuses %s', async (_label, query) => {
      const res = await report(hr, { ...range, ...query });
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });
  });

  describe('the CSV export', () => {
    it('lists approved hours only, without notes, with task references', async () => {
      const res = await exportOf(hr);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const data = exportSchema.parse(res.body);
      expect(data).toMatchObject(range);
      expect(data.rows).toEqual([
        {
          workDate: weekA,
          person: 'dan Test',
          projectCode: p1.code,
          projectName: 'Alpha',
          task: `${p1.code}-1`,
          minutes: 120,
          isBillable: true,
        },
        {
          workDate: addDays(weekA, 1),
          person: 'dan Test',
          projectCode: p2.code,
          projectName: 'Beta',
          task: null,
          minutes: 30,
          isBillable: true,
        },
        {
          workDate: addDays(weekA, 6),
          person: 'dan Test',
          projectCode: p1.code,
          projectName: 'Alpha',
          task: null,
          minutes: 60,
          isBillable: false,
        },
      ]);
      expect(JSON.stringify(res.body)).not.toContain('secret');
    });

    it('can be narrowed to a project and to a period', async () => {
      const one = exportSchema.parse((await exportOf(hr, { projectId: p2.id })).body);
      expect(one.rows.map((r) => r.projectCode)).toEqual([p2.code]);
      const none = exportSchema.parse(
        (await exportOf(hr, { from: addDays(weekA, 7), to: addDays(weekA, 13) })).body,
      );
      expect(none.rows).toEqual([]);
    });

    it('gives managers the projects they lead, and employees nothing', async () => {
      const mine = exportSchema.parse((await exportOf(mia)).body);
      expect(mine.rows.map((r) => r.projectCode)).toEqual([p1.code, p1.code]);
      expect(exportSchema.parse((await exportOf(ron)).body).rows.map((r) => r.projectCode)).toEqual(
        [p2.code],
      );
      expect((await exportOf(mia, { projectId: p2.id })).status).toBe(404);
      for (const who of [dan, eve, gus]) {
        const res = await exportOf(who);
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      }
      expect((await exportOf(hr, { to: 'x' })).status).toBe(400);
      expect((await exportOf(hr, { from: '2024-01-01', to: '2026-01-01' })).status).toBe(400);
    });

    it('is audited with the period and the number of rows, never with the content', async () => {
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: 'time.exported' },
        orderBy: { createdAt: 'asc' },
      });
      expect(entries.length).toBeGreaterThanOrEqual(5);
      expect(entries[0]!.after).toEqual({
        from: range.from,
        to: range.to,
        projectId: null,
        rows: 3,
      });
      expect(JSON.stringify(entries)).not.toContain('dan');
    });
  });

  describe('tenant isolation', () => {
    it('shows another workspace nothing, by id or by listing', async () => {
      const g = globex.admin;
      for (const groupBy of ['project', 'person', 'client']) {
        expect((await reportOf(g, groupBy)).rows).toEqual([]);
      }
      expect((await report(g, { ...range, groupBy: 'project', projectId: p1.id })).status).toBe(
        404,
      );
      const none = exportSchema.parse((await exportOf(g)).body);
      expect(none.rows).toEqual([]);
      expect((await exportOf(g, { projectId: p1.id })).status).toBe(404);
    });
  });
});
