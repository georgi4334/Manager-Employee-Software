import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  assignmentSchema,
  employeeSchema,
  personalDataExportSchema,
  projectDetailSchema,
  taskSchema,
  timeEntrySchema,
  timerResponseSchema,
  timesheetListSchema,
  timesheetSchema,
  timeWeekSchema,
  todayIn,
  weekStartOf,
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
const ZONE = 'Europe/Sofia';
const api = '/api/v1';
const MIN = 60_000;

describe.skipIf(!urls)('time tracker over HTTP (real database)', () => {
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
  let mia: Person; // manager, leads "ofMia", manages dan
  let ron: Person; // manager, unrelated
  let dan: Person; // reports to mia
  let gus: Person; // on no project
  let ofMia: { id: string; code: string };
  let other: { id: string; code: string };

  const today = todayIn(ZONE);
  const thisWeek = weekStartOf(today);
  /** A Monday n weeks ago: each scenario uses its own week so sheets never collide. */
  const weekAgo = (n: number) => addDays(thisWeek, -7 * n);
  const asTenant = <T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>) =>
    app.get(TenantContext).run(tenantId, () => app.get(TenantDb).tx(fn));
  let counter = 0;
  let people = 0;

  async function onboard(
    ws: Workspace,
    name: string,
    role: SystemRole = 'employee',
  ): Promise<Person> {
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
  /** A fresh employee staffed on `ofMia` and managed by mia: one scenario's own timer, entries and weeks. */
  async function fresh(): Promise<Person> {
    const who = await onboard(acme, `p${++people}`);
    const manage = await acme.admin.agent
      .put(`${api}/org/employees/${who.employeeId}/assignment`)
      .send({ managerId: mia.employeeId, departmentId: null });
    expect(manage.status).toBe(204);
    await staff(ofMia.id, who.employeeId);
    return who;
  }
  const makeProject = async (lead: string, name: string, extra: object = {}) => {
    const res = await hr.agent.post(`${api}/projects`).send({
      code: `M${String(++counter).padStart(3, '0')}`,
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

  const log = (who: Member, body: object = {}) =>
    who.agent
      .post(`${api}/time/entries`)
      .send({ projectId: ofMia.id, workDate: weekAgo(1), minutes: 60, ...body });
  const logged = async (who: Member, body: object = {}) => {
    const res = await log(who, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return timeEntrySchema.parse(res.body);
  };
  const week = (who: Member, query: object = {}) => who.agent.get(`${api}/time/week`).query(query);
  const weekOf = async (who: Member, query: object = {}) => {
    const res = await week(who, query);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return timeWeekSchema.parse(res.body);
  };
  const submit = (who: Member, weekStart: string) =>
    who.agent.post(`${api}/time/timesheets/submit`).send({ weekStart });
  const submitted = async (who: Member, weekStart: string) => {
    const res = await submit(who, weekStart);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return timesheetSchema.parse(res.body);
  };
  const decide = (who: Member, id: string, action: 'approve' | 'reject' | 'reopen') =>
    who.agent.post(`${api}/time/timesheets/${id}/${action}`);
  const sheets = async (who: Member, query: object = {}) => {
    const res = await who.agent.get(`${api}/time/timesheets`).query(query);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return timesheetListSchema.parse(res.body);
  };
  const startTimer = (who: Member, body: object = {}) =>
    who.agent.post(`${api}/time/timer/start`).send({ projectId: ofMia.id, ...body });
  const stopTimer = (who: Member) => who.agent.post(`${api}/time/timer/stop`);
  const notesOf = async (who: Member) => {
    await app.get(OutboxWorker).runOnce();
    return (await who.agent.get(`${api}/notifications`)).body.items as {
      type: string;
      params: Record<string, unknown>;
    }[];
  };
  const issue = (res: { status: number; body: unknown }) => [
    res.status,
    errorBody(res).details?.[0]?.code ?? errorBody(res).params?.field ?? errorBody(res).code,
  ];

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
    gus = await onboard(acme, 'gus');
    ofMia = await makeProject(mia.employeeId, 'Led by Mia');
    other = await makeProject(hr.employeeId, 'Led by HR');
    const manage = await acme.admin.agent
      .put(`${api}/org/employees/${dan.employeeId}/assignment`)
      .send({ managerId: mia.employeeId, departmentId: null });
    expect(manage.status).toBe(204);
    await staff(ofMia.id, dan.employeeId);
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe('manual entries', () => {
    it('logs time and gives every field back, with the defaults', async () => {
      const entry = await logged(dan, { minutes: 90, note: '  Reviewed  ' });
      expect(entry).toMatchObject({
        project: { id: ofMia.id, code: ofMia.code },
        task: null,
        workDate: weekAgo(1),
        minutes: 90,
        isBillable: true,
        note: 'Reviewed',
        source: 'manual',
        startedAt: null,
        running: false,
        canEdit: true,
        employee: { id: dan.employeeId },
      });
    });

    it('charges a task of the same project and shows its reference', async () => {
      const task = taskSchema.parse(
        (
          await mia.agent
            .post(`${api}/projects/${ofMia.id}/tasks`)
            .send({ title: 'Build the page', assigneeEmployeeId: dan.employeeId })
        ).body,
      );
      const entry = await logged(dan, { taskId: task.id });
      expect(entry.task).toEqual({ id: task.id, key: task.key });
      const foreign = taskSchema.parse(
        (await hr.agent.post(`${api}/projects/${other.id}/tasks`).send({ title: 'Elsewhere' }))
          .body,
      );
      expect(issue(await log(dan, { taskId: foreign.id }))).toEqual([400, 'task_not_in_project']);
      expect(issue(await log(dan, { taskId: UNKNOWN }))).toEqual([400, 'task_not_in_project']);
    });

    it.each([
      ['no project', { projectId: undefined }, 'VALIDATION_FAILED'],
      ['zero minutes', { minutes: 0 }, 'VALIDATION_FAILED'],
      ['17 hours', { minutes: 961 }, 'VALIDATION_FAILED'],
      ['fractions of a minute', { minutes: 1.5 }, 'VALIDATION_FAILED'],
      ['a bad date', { workDate: '26.10.2026' }, 'VALIDATION_FAILED'],
      ['a long note', { note: 'x'.repeat(501) }, 'VALIDATION_FAILED'],
      ['unknown fields', { employeeId: UNKNOWN }, 'VALIDATION_FAILED'],
    ])('refuses %s', async (_label, patch, code) => {
      const res = await log(dan, patch);
      expect([res.status, errorBody(res).code]).toEqual([400, code]);
    });

    it('refuses projects the person is not on, unknown or finished ones, and the future', async () => {
      expect(issue(await log(gus))).toEqual([400, 'not_on_project']);
      expect(issue(await log(dan, { projectId: other.id }))).toEqual([400, 'not_on_project']);
      expect(issue(await log(dan, { projectId: UNKNOWN }))).toEqual([400, 'unknown_project']);
      const closed = await makeProject(mia.employeeId, 'Finished');
      await staff(closed.id, dan.employeeId);
      expect(
        (await hr.agent.patch(`${api}/projects/${closed.id}`).send({ status: 'done' })).status,
      ).toBe(200);
      expect(issue(await log(dan, { projectId: closed.id }))).toEqual([400, 'project_closed']);
      expect(issue(await log(dan, { workDate: addDays(today, 1) }))).toEqual([400, 'future_date']);
      expect((await log(dan, { workDate: today })).status).toBe(201); // today is fine
    });

    it('lets the lead of a project log on it without being staffed', async () => {
      const res = await log(hr, { projectId: other.id });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    it('keeps a day within 24 hours, boundary included', async () => {
      const p = await fresh();
      const day = weekAgo(9);
      expect((await log(p, { workDate: day, minutes: 960 })).status).toBe(201);
      expect((await log(p, { workDate: day, minutes: 480 })).status).toBe(201); // exactly 24:00
      expect(issue(await log(p, { workDate: day, minutes: 1 }))).toEqual([400, 'day_too_long']);
      expect((await log(p, { workDate: addDays(day, 1), minutes: 960 })).status).toBe(201);
    });

    it('is billable only on billable projects, and when the person says so', async () => {
      const free = await makeProject(mia.employeeId, 'Internal', { isBillable: false });
      await staff(free.id, dan.employeeId);
      expect((await logged(dan, { projectId: free.id })).isBillable).toBe(false);
      expect((await logged(dan, { projectId: free.id, isBillable: true })).isBillable).toBe(false);
      expect((await logged(dan, { isBillable: false })).isBillable).toBe(false);
      expect((await logged(dan)).isBillable).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('changing and deleting entries', () => {
    it('changes fields, clears the note and the task, and moves the date', async () => {
      const p = await fresh();
      const entry = await logged(p, { minutes: 30, note: 'old', workDate: weekAgo(10) });
      const res = await p.agent
        .patch(`${api}/time/entries/${entry.id}`)
        .send({ minutes: 45, note: '', workDate: addDays(weekAgo(10), 1), isBillable: false });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(timeEntrySchema.parse(res.body)).toMatchObject({
        minutes: 45,
        note: null,
        workDate: addDays(weekAgo(10), 1),
        isBillable: false,
      });
    });

    it('moves an entry to another project and drops its task, but refuses wrong targets', async () => {
      const p = await fresh();
      await staff(other.id, p.employeeId);
      const task = taskSchema.parse(
        (await mia.agent.post(`${api}/projects/${ofMia.id}/tasks`).send({ title: 'T' })).body,
      );
      const entry = await logged(p, { taskId: task.id, workDate: weekAgo(11) });
      const moved = await p.agent
        .patch(`${api}/time/entries/${entry.id}`)
        .send({ projectId: other.id });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect(timeEntrySchema.parse(moved.body)).toMatchObject({
        project: { id: other.id },
        task: null,
      });
      const wrongTask = await p.agent
        .patch(`${api}/time/entries/${entry.id}`)
        .send({ taskId: task.id });
      expect(issue(wrongTask)).toEqual([400, 'task_not_in_project']);
      const notMine = await makeProject(mia.employeeId, 'Not mine');
      const stranger = await p.agent
        .patch(`${api}/time/entries/${entry.id}`)
        .send({ projectId: notMine.id });
      expect(issue(stranger)).toEqual([400, 'not_on_project']);
    });

    it('refuses invalid changes: future date, day over 24 hours, nothing to change', async () => {
      const p = await fresh();
      const a = await logged(p, { minutes: 960, workDate: weekAgo(12) });
      const b = await logged(p, { minutes: 60, workDate: addDays(weekAgo(12), 1) });
      const move = await p.agent
        .patch(`${api}/time/entries/${b.id}`)
        .send({ workDate: a.workDate, minutes: 600 });
      expect(issue(move)).toEqual([400, 'day_too_long']);
      const fits = await p.agent
        .patch(`${api}/time/entries/${b.id}`)
        .send({ workDate: a.workDate, minutes: 480 });
      expect(fits.status).toBe(200);
      const future = await p.agent
        .patch(`${api}/time/entries/${b.id}`)
        .send({ workDate: addDays(today, 1) });
      expect(issue(future)).toEqual([400, 'future_date']);
      for (const body of [{}, { minutes: 0 }, { minutes: 961 }]) {
        expect((await p.agent.patch(`${api}/time/entries/${b.id}`).send(body)).status).toBe(400);
      }
    });

    it('is for the owner only: others get "not found", including managers, HR and Admin', async () => {
      const entry = await logged(dan, { workDate: weekAgo(13) });
      for (const who of [mia, hr, ron, gus, acme.admin, globex.admin]) {
        for (const res of [
          await who.agent.patch(`${api}/time/entries/${entry.id}`).send({ minutes: 5 }),
          await who.agent.delete(`${api}/time/entries/${entry.id}`),
        ]) {
          expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
        }
      }
      expect(
        (await dan.agent.patch(`${api}/time/entries/${UNKNOWN}`).send({ minutes: 5 })).status,
      ).toBe(404);
      expect((await dan.agent.delete(`${api}/time/entries/${entry.id}`)).status).toBe(204);
      expect((await dan.agent.delete(`${api}/time/entries/${entry.id}`)).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('the timer', () => {
    it('starts, shows, refuses a second one, and stops with the elapsed minutes', async () => {
      const p = await fresh();
      expect(
        timerResponseSchema.parse((await p.agent.get(`${api}/time/timer`)).body).timer,
      ).toBeNull();
      expect((await stopTimer(p)).status).toBe(404);

      const started = await startTimer(p, { note: 'Focus' });
      expect(started.status, JSON.stringify(started.body)).toBe(201);
      const running = timeEntrySchema.parse(started.body);
      expect(running).toMatchObject({
        running: true,
        minutes: null,
        source: 'timer',
        workDate: today,
        note: 'Focus',
        canEdit: false,
      });
      expect(running.startedAt).not.toBeNull();
      expect(
        timerResponseSchema.parse((await p.agent.get(`${api}/time/timer`)).body).timer?.id,
      ).toBe(running.id);
      expect(issue(await startTimer(p))).toEqual([409, 'running']);
      // running entries cannot be edited or deleted, only stopped
      expect(
        (await p.agent.patch(`${api}/time/entries/${running.id}`).send({ minutes: 5 })).status,
      ).toBe(409);
      expect((await p.agent.delete(`${api}/time/entries/${running.id}`)).status).toBe(409);

      await system.timeEntry.update({
        where: { id: running.id },
        data: { startedAt: new Date(Date.now() - 89.5 * MIN) },
      });
      const stopped = timeEntrySchema.parse((await stopTimer(p)).body);
      expect(stopped).toMatchObject({ running: false, minutes: 90, canEdit: true });
      expect((await stopTimer(p)).status).toBe(404);
      expect(
        timerResponseSchema.parse((await p.agent.get(`${api}/time/timer`)).body).timer,
      ).toBeNull();
      expect((await startTimer(p)).status).toBe(201); // free again
    });

    it('counts at least one minute and caps a forgotten timer at 16 hours', async () => {
      const quick = await fresh();
      await startTimer(quick);
      expect(timeEntrySchema.parse((await stopTimer(quick)).body).minutes).toBe(1);

      const forgot = await fresh();
      const id = timeEntrySchema.parse((await startTimer(forgot)).body).id;
      await system.timeEntry.update({
        where: { id },
        data: { startedAt: new Date(Date.now() - 20 * 60 * MIN) },
      });
      const stopped = timeEntrySchema.parse((await stopTimer(forgot)).body);
      expect(stopped.minutes).toBe(960);
      const row = await system.timeEntry.findUniqueOrThrow({ where: { id } });
      expect(row.endedAt!.getTime() - row.startedAt!.getTime()).toBe(960 * MIN);
    });

    it('lets only one of two simultaneous starts win', async () => {
      const p = await fresh();
      const results = await Promise.all([startTimer(p), startTimer(p), startTimer(p)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    });

    it('needs a project the person works on', async () => {
      expect(issue(await startTimer(gus))).toEqual([400, 'not_on_project']);
      expect(issue(await startTimer(dan, { projectId: UNKNOWN }))).toEqual([
        400,
        'unknown_project',
      ]);
      expect(issue(await startTimer(dan, { taskId: UNKNOWN }))).toEqual([
        400,
        'task_not_in_project',
      ]);
      expect((await dan.agent.post(`${api}/time/timer/start`).send({})).status).toBe(400);
    });

    it('does not start in a week that is submitted', async () => {
      const p = await fresh();
      await logged(p, { workDate: today });
      await submitted(p, thisWeek);
      expect(issue(await startTimer(p))).toEqual([409, 'locked']);
    });

    it('stops when the employee is deactivated', async () => {
      const leaver = await fresh();
      const id = timeEntrySchema.parse((await startTimer(leaver)).body).id;
      const res = await hr.agent
        .post(`${api}/employees/${leaver.employeeId}/deactivate`)
        .send({ terminationDate: today });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const row = await system.timeEntry.findUniqueOrThrow({ where: { id } });
      expect(row.endedAt).not.toBeNull();
      expect(row.minutes).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('weeks', () => {
    it('shows entries, day totals and billable minutes of the week, any day in it', async () => {
      const p = await fresh();
      const monday = weekAgo(14);
      await logged(p, { workDate: monday, minutes: 60 });
      await logged(p, { workDate: monday, minutes: 30, isBillable: false });
      await logged(p, { workDate: addDays(monday, 6), minutes: 120 });
      await logged(p, { workDate: addDays(monday, 7), minutes: 600 }); // next week
      const w = await weekOf(p, { weekStart: addDays(monday, 3) });
      expect(w).toMatchObject({
        weekStart: monday,
        status: null,
        timesheetId: null,
        totalMinutes: 210,
        billableMinutes: 180,
        canSubmit: true,
      });
      expect(w.entries).toHaveLength(3);
      expect(w.days.map((d) => d.minutes)).toEqual([90, 0, 0, 0, 0, 0, 120]);
      expect(w.days[0]!.date).toBe(monday);
      expect((await weekOf(p)).weekStart).toBe(thisWeek); // default: this week
    });

    it('does not offer to submit a week of the future', async () => {
      const w = await weekOf(dan, { weekStart: addDays(thisWeek, 14) });
      expect(w.canSubmit).toBe(false);
    });

    it('lets managers and HR read their people, nobody else', async () => {
      const p = await fresh();
      const e = await logged(p, { workDate: weekAgo(15) });
      const query = { employeeId: p.employeeId, weekStart: weekAgo(15) };
      for (const who of [mia, hr, acme.admin]) {
        const w = await weekOf(who, query);
        expect(w.entries.map((x) => x.id)).toEqual([e.id]);
        expect(w.entries[0]!.canEdit).toBe(false); // reading is not editing
        expect(w.canSubmit).toBe(false);
      }
      for (const who of [ron, dan, gus, globex.admin]) {
        const res = await week(who, query);
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      expect((await week(hr, { employeeId: UNKNOWN })).status).toBe(404);
      expect((await week(dan, { weekStart: 'x' })).status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('timesheets', () => {
    it('is submitted for a week with time in it, and then locks the week', async () => {
      const p = await fresh();
      const start = weekAgo(16);
      const e = await logged(p, { workDate: addDays(start, 2), minutes: 120 });
      const sheet = await submitted(p, start);
      expect(sheet).toMatchObject({
        weekStart: start,
        status: 'submitted',
        totalMinutes: 120,
        decidedAt: null,
        canDecide: false,
        canReopen: false,
        employee: { id: p.employeeId },
      });
      const w = await weekOf(p, { weekStart: start });
      expect(w).toMatchObject({ status: 'submitted', timesheetId: sheet.id, canSubmit: false });
      expect(w.entries.every((x) => !x.canEdit)).toBe(true);

      for (const res of [
        await log(p, { workDate: addDays(start, 3) }),
        await p.agent.patch(`${api}/time/entries/${e.id}`).send({ minutes: 5 }),
        await p.agent.delete(`${api}/time/entries/${e.id}`),
        await submit(p, start),
      ]) {
        expect(issue(res)).toEqual([409, 'locked']);
      }
      // moving an entry INTO a locked week is refused as well
      const outside = await logged(p, { workDate: addDays(start, -1) });
      const into = await p.agent
        .patch(`${api}/time/entries/${outside.id}`)
        .send({ workDate: addDays(start, 1) });
      expect(issue(into)).toEqual([409, 'locked']);
    });

    it.each([
      ['a day that is not a Monday', (w: string) => addDays(w, 1), 'not_a_monday'],
      ['a week that has not started', () => addDays(thisWeek, 7), 'future_week'],
      ['a week without time', (w: string) => w, 'no_entries'],
    ])('refuses %s', async (_label, pick, code) => {
      const p = await fresh();
      const res = await submit(p, pick(weekAgo(17)));
      expect(issue(res)).toEqual([400, code]);
    });

    it('refuses a week with a running timer, and a bad body', async () => {
      const p = await fresh();
      await startTimer(p);
      expect(issue(await submit(p, thisWeek))).toEqual([400, 'timer_running']);
      expect((await p.agent.post(`${api}/time/timesheets/submit`).send({})).status).toBe(400);
      expect(
        (await p.agent.post(`${api}/time/timesheets/submit`).send({ weekStart: '2026-13-01' }))
          .status,
      ).toBe(400);
    });

    it('can be submitted for the current week', async () => {
      const p = await fresh();
      await logged(p, { workDate: today });
      expect((await submit(p, thisWeek)).status).toBe(200);
    });

    it('is approved by the manager, who then locks it and tells the owner', async () => {
      const p = await fresh();
      const start = weekAgo(18);
      await logged(p, { workDate: start, minutes: 100, note: 'secret detail' });
      const sheet = await submitted(p, start);

      const pending = await sheets(mia);
      const mine = pending.items.find((s) => s.id === sheet.id)!;
      expect(mine).toMatchObject({ status: 'submitted', canDecide: true, totalMinutes: 100 });
      expect((await sheets(ron)).items.map((s) => s.id)).not.toContain(sheet.id);
      expect((await sheets(hr)).items.map((s) => s.id)).toContain(sheet.id);

      const detail = timeWeekSchema.parse(
        (await mia.agent.get(`${api}/time/timesheets/${sheet.id}`)).body,
      );
      expect(detail.entries).toHaveLength(1);
      expect(detail.entries[0]!.canEdit).toBe(false);

      const res = await decide(mia, sheet.id, 'approve');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(timesheetSchema.parse(res.body)).toMatchObject({
        status: 'approved',
        canDecide: false,
        canReopen: false, // managers cannot reopen
      });
      const row = await system.timesheet.findUniqueOrThrow({ where: { id: sheet.id } });
      expect(row.decidedByEmployeeId).toBe(mia.employeeId);
      expect(row.decidedAt).not.toBeNull();

      const note = (await notesOf(p)).find((n) => n.type === 'timesheet.decided')!;
      expect(note.params).toEqual({ weekStart: start, decision: 'approved' });
      expect(JSON.stringify(note)).not.toContain('secret');
      expect(issue(await decide(mia, sheet.id, 'approve'))).toEqual([409, 'status']);
      expect(issue(await decide(mia, sheet.id, 'reject'))).toEqual([409, 'status']);
    });

    it('is sent back with a reject: the person edits and submits again', async () => {
      const p = await fresh();
      const start = weekAgo(19);
      const e = await logged(p, { workDate: start, minutes: 30 });
      const sheet = await submitted(p, start);
      const res = await decide(hr, sheet.id, 'reject');
      expect(timesheetSchema.parse(res.body).status).toBe('rejected');
      const note = (await notesOf(p)).filter((n) => n.type === 'timesheet.decided').at(-1)!;
      expect(note.params).toEqual({ weekStart: start, decision: 'rejected' });

      expect(
        (await p.agent.patch(`${api}/time/entries/${e.id}`).send({ minutes: 45 })).status,
      ).toBe(200);
      expect((await log(p, { workDate: addDays(start, 1) })).status).toBe(201);
      const again = await submitted(p, start);
      expect(again).toMatchObject({ id: sheet.id, status: 'submitted', totalMinutes: 105 });
      expect(await decide(hr, sheet.id, 'approve').then((r) => r.status)).toBe(200);
    });

    it('is decided by people in scope only, never by oneself', async () => {
      const p = await fresh();
      const start = weekAgo(20);
      await logged(p, { workDate: start });
      const sheet = await submitted(p, start);
      for (const who of [ron, dan, gus, globex.admin]) {
        for (const action of ['approve', 'reject'] as const) {
          const res = await decide(who, sheet.id, action);
          expect([404, 403], `${who.email} ${action}`).toContain(res.status);
        }
      }
      expect((await dan.agent.get(`${api}/time/timesheets`)).status).toBe(403); // no approve permission
      expect((await ron.agent.get(`${api}/time/timesheets/${sheet.id}`)).status).toBe(404);
      expect((await mia.agent.get(`${api}/time/timesheets/${UNKNOWN}`)).status).toBe(404);
      expect((await decide(mia, UNKNOWN, 'approve')).status).toBe(404);
      expect((await mia.agent.get(`${api}/time/timesheets/not-an-id`)).status).toBe(400);
      expect(
        (await mia.agent.get(`${api}/time/timesheets`).query({ status: 'locked' })).status,
      ).toBe(400);
      expect((await sheets(mia, { status: 'rejected' })).items.map((s) => s.id)).not.toContain(
        sheet.id,
      );

      // HR and Admin cannot decide their own week either
      const mine = weekAgo(20);
      await logged(hr, { projectId: other.id, workDate: mine });
      const own = await submitted(hr, mine);
      expect(own.canDecide).toBe(false); // nobody decides their own week, so no button either
      expect((await sheets(hr)).items.map((s) => s.id)).not.toContain(own.id);
      for (const action of ['approve', 'reject'] as const) {
        const res = await decide(hr, own.id, action);
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      }
      expect((await decide(acme.admin, own.id, 'approve')).status).toBe(200);
    });

    it('is reopened by HR or Admin, not by managers and not on their own week', async () => {
      const p = await fresh();
      const start = weekAgo(21);
      await logged(p, { workDate: start });
      const sheet = await submitted(p, start);
      expect(issue(await decide(hr, sheet.id, 'reopen'))).toEqual([409, 'status']); // not approved yet
      await decide(mia, sheet.id, 'approve');
      expect((await decide(mia, sheet.id, 'reopen')).status).toBe(403);
      expect((await decide(p, sheet.id, 'reopen')).status).toBe(403);
      const res = await decide(hr, sheet.id, 'reopen');
      expect(timesheetSchema.parse(res.body).status).toBe('open');
      expect((await log(p, { workDate: addDays(start, 1) })).status).toBe(201); // editable again
      expect((await submit(p, start)).status).toBe(200);

      const mine = weekAgo(21);
      await logged(hr, { projectId: other.id, workDate: mine });
      const own = await submitted(hr, mine);
      await decide(acme.admin, own.id, 'approve');
      const forbidden = await decide(hr, own.id, 'reopen');
      expect([forbidden.status, errorBody(forbidden).code]).toEqual([403, 'FORBIDDEN']);
      expect((await decide(acme.admin, own.id, 'reopen')).status).toBe(200);
    });

    it('lists by status and pages', async () => {
      const all = await sheets(hr, { status: 'all', pageSize: 2 });
      expect(all.items.length).toBeLessThanOrEqual(2);
      expect(all.total).toBeGreaterThan(2);
      const second = await sheets(hr, { status: 'all', pageSize: 2, page: 2 });
      expect(second.items.map((s) => s.id)).not.toEqual(all.items.map((s) => s.id));
      expect((await sheets(hr)).items.every((s) => s.status === 'submitted')).toBe(true);
    });

    it('audits ids and the week, never notes', async () => {
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: { startsWith: 'timesheet.' } },
      });
      expect(entries.length).toBeGreaterThan(3);
      expect(new Set(entries.map((e) => e.action))).toEqual(
        new Set([
          'timesheet.submitted',
          'timesheet.approved',
          'timesheet.rejected',
          'timesheet.reopened',
        ]),
      );
      expect(JSON.stringify(entries)).not.toContain('secret detail');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('privacy and offboarding', () => {
    it('lists time in the data export', async () => {
      const p = await fresh();
      const start = weekAgo(22);
      await logged(p, { workDate: start, minutes: 75, note: 'for the export' });
      await submitted(p, start);
      const own = personalDataExportSchema.parse((await p.agent.get(`${api}/privacy/export`)).body);
      expect(own.time.entries).toEqual([
        {
          workDate: start,
          minutes: 75,
          project: ofMia.code,
          task: null,
          isBillable: true,
          note: 'for the export',
          source: 'manual',
        },
      ]);
      expect(own.time.timesheets).toEqual([{ weekStart: start, status: 'submitted' }]);
      const hrView = personalDataExportSchema.parse(
        (await hr.agent.get(`${api}/privacy/export/${p.employeeId}`)).body,
      );
      expect(hrView.time.entries).toHaveLength(1);
      const empty = personalDataExportSchema.parse(
        (await gus.agent.get(`${api}/privacy/export`)).body,
      );
      expect(empty.time).toEqual({ entries: [], timesheets: [] });
    });

    it('erases notes but keeps the hours of a former employee', async () => {
      const leaver = await fresh();
      await logged(leaver, { workDate: weekAgo(23), minutes: 50, note: 'private words' });
      expect(
        (
          await hr.agent
            .post(`${api}/employees/${leaver.employeeId}/deactivate`)
            .send({ terminationDate: today })
        ).status,
      ).toBe(200);
      const res = await hr.agent
        .post(`${api}/privacy/erase/${leaver.employeeId}`)
        .send({ confirm: true });
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      const rows = await system.timeEntry.findMany({ where: { employeeId: leaver.employeeId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ minutes: 50, note: null });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('tenant isolation and database rules', () => {
    it('keeps another workspace away from entries and sheets, in reads and every write', async () => {
      const p = await fresh();
      const start = weekAgo(24);
      const e = await logged(p, { workDate: start });
      const sheet = await submitted(p, start);
      const g = globex.admin;
      for (const res of [
        await week(g, { employeeId: p.employeeId, weekStart: start }),
        await g.agent.patch(`${api}/time/entries/${e.id}`).send({ minutes: 5 }),
        await g.agent.delete(`${api}/time/entries/${e.id}`),
        await g.agent.get(`${api}/time/timesheets/${sheet.id}`),
        await decide(g, sheet.id, 'approve'),
        await decide(g, sheet.id, 'reopen'),
      ]) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      expect((await sheets(g, { status: 'all' })).items).toEqual([]);
      expect(
        await asTenant(globex.tenantId, (tx) => tx.timeEntry.findUnique({ where: { id: e.id } })),
      ).toBeNull();
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.timesheet.findUnique({ where: { id: sheet.id } }),
        ),
      ).toBeNull();
      expect(
        await asTenant(globex.tenantId, (tx) => tx.timeEntry.deleteMany({ where: { id: e.id } })),
      ).toEqual({ count: 0 });
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.timesheet.updateMany({ where: { id: sheet.id }, data: { status: 'approved' } }),
        ),
      ).toEqual({ count: 0 });
      await expect(
        asTenant(globex.tenantId, (tx) =>
          tx.timeEntry.create({
            data: {
              tenantId: acme.tenantId,
              employeeId: p.employeeId,
              projectId: ofMia.id,
              workDate: new Date(`${start}T00:00:00Z`),
              minutes: 5,
              source: 'manual',
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it('enforces the rules in the database when the application is bypassed', async () => {
      const p = await fresh();
      const base = {
        tenantId: acme.tenantId,
        employeeId: p.employeeId,
        projectId: ofMia.id,
        workDate: new Date(`${weekAgo(25)}T00:00:00Z`),
      };
      const manual = { source: 'manual', minutes: 10 };
      const refuse = (data: object) =>
        expect(system.timeEntry.create({ data: { ...base, ...data } as never })).rejects.toThrow();
      await refuse({ source: 'other', minutes: 10 });
      await refuse({ ...manual, minutes: 0 });
      await refuse({ ...manual, minutes: 961 });
      await refuse({ ...manual, minutes: null }); // a manual entry without minutes
      await refuse({ ...manual, startedAt: new Date() }); // a manual entry with a start
      await refuse({ ...manual, note: 'x'.repeat(501) });
      await refuse({ source: 'timer', minutes: 10 }); // a timer without a start
      await refuse({ source: 'timer', startedAt: new Date(), minutes: 10 }); // minutes but not stopped
      await refuse({ source: 'timer', startedAt: new Date(), endedAt: new Date() }); // stopped without minutes
      await refuse({
        source: 'timer',
        startedAt: new Date(),
        endedAt: new Date(Date.now() - MIN),
        minutes: 1,
      }); // ended before it began
      await refuse({ ...manual, taskId: UNKNOWN }); // no such task
      const foreignTask = taskSchema.parse(
        (await hr.agent.post(`${api}/projects/${other.id}/tasks`).send({ title: 'Other project' }))
          .body,
      );
      await refuse({ ...manual, taskId: foreignTask.id }); // a task of another project
      const foreign = await system.employee.findFirstOrThrow({
        where: { tenantId: globex.tenantId },
      });
      await refuse({ ...manual, employeeId: foreign.id }); // a person of another workspace
      // one running timer per person
      const started = new Date();
      await system.timeEntry.create({ data: { ...base, source: 'timer', startedAt: started } });
      await expect(
        system.timeEntry.create({ data: { ...base, source: 'timer', startedAt: started } }),
      ).rejects.toThrow();

      const sheetBase = {
        tenantId: acme.tenantId,
        employeeId: p.employeeId,
        submittedAt: new Date(),
      };
      const monday = new Date(`${weekAgo(26)}T00:00:00Z`);
      await expect(
        system.timesheet.create({ data: { ...sheetBase, weekStart: monday, status: 'locked' } }),
      ).rejects.toThrow();
      await expect(
        system.timesheet.create({
          data: {
            ...sheetBase,
            weekStart: new Date(`${addDays(weekAgo(26), 2)}T00:00:00Z`),
            status: 'submitted',
          },
        }),
      ).rejects.toThrow(); // not a Monday
      await system.timesheet.create({
        data: { ...sheetBase, weekStart: monday, status: 'submitted' },
      });
      await expect(
        system.timesheet.create({ data: { ...sheetBase, weekStart: monday, status: 'submitted' } }),
      ).rejects.toThrow(); // one sheet per person and week
    });
  });
});
