import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  assignmentSchema,
  capacitySchema,
  type Capacity,
  employeeSchema,
  projectDetailSchema,
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

describe.skipIf(!urls)('capacity over HTTP (real database)', () => {
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
  let mia: Person; // manager of dan
  let ron: Person; // manager of nobody
  let dan: Person;
  let eve: Person;
  let newbie: Person; // hired in the middle of the week
  let idle: Person; // on no project at all
  let p1: { id: string; code: string };
  let p2: { id: string; code: string };

  const today = todayIn(ZONE);
  // A week in the past: logged time can only be typed for days that have begun.
  const mon = addDays(weekStartOf(today), -14);
  const [tue, wed, thu, fri, sat, sun] = [1, 2, 3, 4, 5, 6].map((n) => addDays(mon, n)) as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const week = { from: mon, to: sun };
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
      code: `C${String(++counter).padStart(3, '0')}`,
      name,
      startDate: addDays(today, -400),
      status: 'active',
      leadEmployeeId: lead,
      ...extra,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return projectDetailSchema.parse(res.body);
  };
  const staff = async (project: string, employeeId: string, pct: number, extra: object = {}) => {
    const res = await hr.agent
      .post(`${api}/projects/${project}/assignments`)
      .send({ employeeId, allocationPct: pct, fromDate: addDays(today, -400), ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return assignmentSchema.parse(res.body);
  };
  const ask = (who: Member, query: object = {}) =>
    who.agent.get(`${api}/capacity`).query({ ...week, ...query });
  const overview = async (who: Member, query: object = {}) => {
    const res = await ask(who, query);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return capacitySchema.parse(res.body);
  };
  const of = (list: Capacity, who: Person) =>
    list.items.find((i) => i.employee.id === who.employeeId)!;

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
    newbie = await onboard(acme, 'newbie', 'employee', { hireDate: wed });
    idle = await onboard(acme, 'idle');
    const manage = await acme.admin.agent
      .put(`${api}/org/employees/${dan.employeeId}/assignment`)
      .send({ managerId: mia.employeeId, departmentId: null });
    expect(manage.status).toBe(204);

    // Thursday is a holiday for everybody, Friday a half-day holiday
    for (const [date, halfDay] of [
      [thu, false],
      [fri, true],
    ] as const) {
      const res = await hr.agent
        .post(`${api}/leave/holidays`)
        .send({ date, name: 'Company day', country: null, halfDay });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    p1 = await makeProject(mia.employeeId, 'Alpha');
    p2 = await makeProject(hr.employeeId, 'Beta');
    const finished = await makeProject(hr.employeeId, 'Finished');
    await staff(p1.id, dan.employeeId, 50);
    await staff(p2.id, dan.employeeId, 60, { fromDate: tue }); // from Tuesday: 110 % on Tuesday
    await staff(finished.id, dan.employeeId, 100);
    expect(
      (await hr.agent.patch(`${api}/projects/${finished.id}`).send({ status: 'done' })).status,
    ).toBe(200);
    await staff(p1.id, newbie.employeeId, 25);
    const short = await makeProject(hr.employeeId, 'Short');
    await staff(short.id, eve.employeeId, 25, { toDate: tue }); // its last day is Tuesday

    // Wednesday off for Dan (approved)
    const types = (await dan.agent.get(`${api}/leave/types`)).body as { id: string; key: string }[];
    const leave = await dan.agent.post(`${api}/leave/requests`).send({
      leaveTypeId: types.find((t) => t.key === 'unpaid')!.id,
      startDate: wed,
      endDate: wed,
    });
    expect(leave.status, JSON.stringify(leave.body)).toBe(201);
    expect(
      (
        await hr.agent
          .post(`${api}/leave/requests/${(leave.body as { id: string }).id}/approve`)
          .send({})
      ).status,
    ).toBe(200);
    // and a pending request for Monday that must not reduce anything yet
    const pending = await eve.agent.post(`${api}/leave/requests`).send({
      leaveTypeId: types.find((t) => t.key === 'unpaid')!.id,
      startDate: mon,
      endDate: mon,
    });
    expect(pending.status, JSON.stringify(pending.body)).toBe(201);

    // logged time
    for (const [project, date, minutes] of [
      [p1.id, mon, 120],
      [p2.id, tue, 60],
    ] as const) {
      const res = await dan.agent
        .post(`${api}/time/entries`)
        .send({ projectId: project, workDate: date, minutes });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  describe('the numbers of a week', () => {
    it('takes out holidays, leave and the weekend, then plans the allocations on what is left', async () => {
      const dans = of(await overview(hr), dan);
      expect(
        dans.days.map((d) => [
          d.date,
          d.availableMinutes,
          d.plannedMinutes,
          d.loggedMinutes,
          d.status,
        ]),
      ).toEqual([
        [mon, 480, 240, 120, 'busy'], // 50 %
        [tue, 480, 528, 60, 'over'], // 50 % + 60 %
        [wed, 0, 0, 0, 'leave'],
        [thu, 0, 0, 0, 'off'], // holiday
        [fri, 240, 264, 0, 'over'], // half-day holiday, 110 % of 4 hours
        [sat, 0, 0, 0, 'off'],
        [sun, 0, 0, 0, 'off'],
      ]);
      expect(dans).toMatchObject({
        availableMinutes: 480 + 480 + 0 + 0 + 240,
        plannedMinutes: 240 + 528 + 264,
        loggedMinutes: 180,
        freeMinutes: 168, // 1200 available, 1032 planned: the week is full although Tuesday is over-booked
        level: 'full',
      });
    });

    it('shows a person without staffing as free, with the whole available time', async () => {
      const idles = of(await overview(hr), idle);
      expect(idles).toMatchObject({
        availableMinutes: 480 * 3 + 240, // Monday to Wednesday, Thursday is a holiday, Friday half
        plannedMinutes: 0,
        level: 'free',
        projects: [],
      });
      expect(idles.availableMinutes).toBe(480 * 3 + 240);
      expect(idles.freeMinutes).toBe(480 * 3 + 240);
      expect(idles.days[0]).toMatchObject({ availableMinutes: 480, status: 'free' });
    });

    it('ignores pending leave, and plans an assignment up to and including its last day', async () => {
      const eves = of(await overview(hr), eve);
      expect(eves.availableMinutes).toBe(480 * 3 + 240); // the pending request for Monday changes nothing
      expect(eves.days.map((d) => d.plannedMinutes)).toEqual([120, 120, 0, 0, 0, 0, 0]);
      expect(eves.level).toBe('busy');
    });

    it('uses the holidays of the person’s own country', async () => {
      const german = await onboard(acme, 'german', 'employee', { country: 'DE' });
      const bulgarian = await onboard(acme, 'bulgarian', 'employee', { country: 'BG' });
      // Whit Monday 2027 is 17 May: a holiday in Germany, not in Bulgaria (6 May is St George's Day there)
      const may = { from: '2027-05-17', to: '2027-05-23' };
      const list = await overview(hr, may);
      expect(of(list, german).days[0]).toMatchObject({
        date: '2027-05-17',
        availableMinutes: 0,
        status: 'off',
      });
      expect(of(list, bulgarian).days[0]).toMatchObject({
        date: '2027-05-17',
        availableMinutes: 480,
      });
    });

    it('counts only the days of the employment', async () => {
      const n = of(await overview(hr), newbie);
      expect(n.days.map((d) => d.availableMinutes)).toEqual([0, 0, 480, 0, 240, 0, 0]);
      expect(n).toMatchObject({ availableMinutes: 720, plannedMinutes: 120 + 60, level: 'busy' });
    });

    it('leaves finished projects out of the plan', async () => {
      const dans = of(await overview(hr), dan);
      expect(dans.projects.map((p) => p.name)).toEqual(['Alpha', 'Beta']); // biggest first, no "Finished"
    });

    it('splits planned and logged time by project, and the parts add up', async () => {
      const dans = of(await overview(hr), dan);
      expect(dans.projects).toEqual([
        {
          id: p1.id,
          code: p1.code,
          name: 'Alpha',
          plannedMinutes: 240 + 240 + 120,
          loggedMinutes: 120,
        },
        { id: p2.id, code: p2.code, name: 'Beta', plannedMinutes: 288 + 144, loggedMinutes: 60 },
      ]);
      expect(dans.projects.reduce((s, p) => s + p.plannedMinutes, 0)).toBe(dans.plannedMinutes);
      expect(dans.projects.reduce((s, p) => s + p.loggedMinutes, 0)).toBe(dans.loggedMinutes);
    });

    it('works for a single day and for the longest period', async () => {
      const one = of(await overview(hr, { from: tue, to: tue }), dan);
      expect(one.days).toHaveLength(1);
      expect(one.availableMinutes).toBe(480);
      const long = await overview(hr, { from: mon, to: addDays(mon, 30) });
      expect(of(long, dan).days).toHaveLength(31);
    });
  });

  describe('who is listed', () => {
    it('gives HR and Admin everybody, managers their people and themselves, employees themselves', async () => {
      const names = async (who: Member) =>
        (await overview(who)).items.map((i) => i.employee.firstName).sort();
      expect(await names(hr)).toEqual(
        expect.arrayContaining(['Workspace', 'dan', 'eve', 'hrx', 'idle', 'mia', 'newbie', 'ron']),
      );
      expect(await names(acme.admin)).toContain('dan');
      expect(await names(mia)).toEqual(['dan', 'mia']);
      expect(await names(ron)).toEqual(['ron']);
      expect(await names(dan)).toEqual(['dan']);
      expect(await names(eve)).toEqual(['eve']);
    });

    it('lists people sorted by name, and pages', async () => {
      const all = await overview(hr);
      expect(all.items.map((i) => i.employee.lastName + i.employee.firstName)).toEqual(
        [...all.items.map((i) => i.employee.lastName + i.employee.firstName)].sort(),
      );
      const first = await overview(hr, { pageSize: 2 });
      const second = await overview(hr, { pageSize: 2, page: 2 });
      expect(first.total).toBe(all.total);
      expect(first.items).toHaveLength(2);
      expect(second.items.map((i) => i.employee.id)).toEqual(
        all.items.slice(2, 4).map((i) => i.employee.id),
      );
      expect((await overview(hr, { page: 99 })).items).toEqual([]);
    });

    it('filters by name, case-insensitively, without treating % as a wildcard', async () => {
      expect((await overview(hr, { q: 'DAN' })).items.map((i) => i.employee.firstName)).toEqual([
        'dan',
      ]);
      expect((await overview(hr, { q: 'zzz' })).total).toBe(0);
      expect((await overview(hr, { q: 'new nobody' })).total).toBe(0); // every word must match
      expect((await overview(hr, { q: '%' })).total).toBe(0);
    });

    it('filters by project and keeps people staffed on it in that period', async () => {
      const onBeta = await overview(hr, { projectId: p2.id });
      expect(onBeta.items.map((i) => i.employee.firstName)).toEqual(['dan']);
      const after = await overview(hr, {
        projectId: p2.id,
        from: addDays(tue, -2),
        to: addDays(tue, -1),
      });
      expect(after.items).toEqual([]); // Beta started on Tuesday
      expect((await ask(hr, { projectId: UNKNOWN })).status).toBe(404);
    });

    it('does not list inactive people', async () => {
      const gone = await onboard(acme, 'gone');
      expect(
        (
          await hr.agent
            .post(`${api}/employees/${gone.employeeId}/deactivate`)
            .send({ terminationDate: today })
        ).status,
      ).toBe(200);
      expect((await overview(hr)).items.map((i) => i.employee.firstName)).not.toContain('gone');
    });
  });

  describe('what a caller may see of the projects', () => {
    it('hides the project of a project filter from people who cannot see it', async () => {
      const res = await ask(ron, { projectId: p1.id });
      expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      expect((await ask(mia, { projectId: p1.id })).status).toBe(200);
    });

    it('sums the projects a viewer may not see in one row, so the totals still add up', async () => {
      const blind = await onboard(acme, 'blind');
      const role = await system.role.create({
        data: {
          tenantId: acme.tenantId,
          name: 'Planner',
          permissions: { create: [{ permissionCode: 'capacity.view', scope: 'all' }] },
        },
      });
      const granted = await acme.admin.agent
        .put(`${api}/users/${blind.id}/roles`)
        .send({ roleIds: [role.id] });
      expect(granted.status, JSON.stringify(granted.body)).toBe(200);
      const dans = of(await overview(blind), dan);
      expect(dans.projects).toEqual([
        {
          id: null,
          code: null,
          name: null,
          plannedMinutes: dans.plannedMinutes,
          loggedMinutes: 180,
        },
      ]);
      expect(JSON.stringify(dans)).not.toContain('Alpha');
      expect(JSON.stringify(dans)).not.toContain('Beta');
      expect(dans.level).toBe('full'); // the numbers themselves are complete
    });
  });

  describe('input and workspaces', () => {
    it.each([
      ['no start', { from: undefined }],
      ['no end', { to: undefined }],
      ['an end before the start', { from: sun, to: mon }],
      ['a bad date', { from: '1.3.2027' }],
      ['more than 31 days', { to: addDays(mon, 31) }],
      ['a bad project id', { projectId: 'x' }],
      ['a page size over 100', { pageSize: 101 }],
      ['page zero', { page: 0 }],
    ])('refuses %s', async (_label, patch) => {
      const res = await ask(hr, patch);
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('needs the capacity permission', async () => {
      const none = await onboard(acme, 'nocap');
      const role = await system.role.create({
        data: {
          tenantId: acme.tenantId,
          name: 'No capacity',
          permissions: { create: [{ permissionCode: 'time.log', scope: 'own' }] },
        },
      });
      expect(
        (await acme.admin.agent.put(`${api}/users/${none.id}/roles`).send({ roleIds: [role.id] }))
          .status,
      ).toBe(200);
      const res = await ask(none);
      expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
    });

    it('shows another workspace only its own people and nothing of ours', async () => {
      const g = await overview(globex.admin);
      expect(g.items.map((i) => i.employee.id)).not.toContain(dan.employeeId);
      expect(g.items.every((i) => i.projects.length === 0)).toBe(true);
      expect((await ask(globex.admin, { projectId: p1.id })).status).toBe(404);
    });
  });
});
