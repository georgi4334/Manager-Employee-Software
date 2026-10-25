import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  assignmentSchema,
  employeeSchema,
  leaveConflictsSchema,
  milestoneSchema,
  projectDetailSchema,
  taskSchema,
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

describe.skipIf(!urls)('leave conflicts over HTTP (real database)', () => {
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
  let mia: Person; // manager of dan, leads P1
  let ron: Person; // manager with no authority over dan
  let dan: Person;
  let eve: Person;
  let p1: { id: string; code: string };
  let p2: { id: string; code: string };
  let requestId: string;
  let counter = 0;

  const today = todayIn(ZONE);
  // Monday to Wednesday, a few weeks ahead
  const from = addDays(weekStartOf(today), 28);
  const to = addDays(from, 2);

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
  const makeProject = async (lead: string, name: string) => {
    const res = await hr.agent.post(`${api}/projects`).send({
      code: `L${String(++counter).padStart(3, '0')}`,
      name,
      startDate: addDays(today, -100),
      status: 'active',
      leadEmployeeId: lead,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return projectDetailSchema.parse(res.body);
  };
  const staff = async (project: string, employeeId: string, extra: object = {}) => {
    const res = await hr.agent
      .post(`${api}/projects/${project}/assignments`)
      .send({ employeeId, allocationPct: 30, fromDate: addDays(today, -100), ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return assignmentSchema.parse(res.body);
  };
  const milestone = async (project: string, title: string, dueDate: string) => {
    const res = await hr.agent
      .post(`${api}/projects/${project}/milestones`)
      .send({ title, dueDate });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return milestoneSchema.parse(res.body);
  };
  const task = async (project: string, body: object) => {
    const res = await hr.agent
      .post(`${api}/projects/${project}/tasks`)
      .send({ title: 'Secret task title', ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return taskSchema.parse(res.body);
  };
  const conflictsFor = (who: Member, id = requestId) =>
    who.agent.get(`${api}/leave/requests/${id}/conflicts`);
  const conflictsOf = async (who: Member) => {
    const res = await conflictsFor(who);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return leaveConflictsSchema.parse(res.body);
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
    dan = await onboard(acme, 'dan');
    eve = await onboard(acme, 'eve');
    const manage = await acme.admin.agent
      .put(`${api}/org/employees/${dan.employeeId}/assignment`)
      .send({ managerId: mia.employeeId, departmentId: null });
    expect(manage.status).toBe(204);

    p1 = await makeProject(mia.employeeId, 'Alpha');
    p2 = await makeProject(hr.employeeId, 'Beta');
    const later = await makeProject(hr.employeeId, 'Later');
    const finished = await makeProject(hr.employeeId, 'Finished');
    await staff(p1.id, dan.employeeId);
    await staff(p2.id, dan.employeeId, { fromDate: addDays(from, 1) }); // starts during the leave
    await staff(later.id, dan.employeeId, { fromDate: addDays(to, 1) }); // starts right after
    await staff(finished.id, dan.employeeId);
    const endsOnStart = await makeProject(hr.employeeId, 'Ends on start');
    const endedBefore = await makeProject(hr.employeeId, 'Ended before');
    await staff(endsOnStart.id, dan.employeeId, { toDate: from }); // its last day is the first day away
    await staff(endedBefore.id, dan.employeeId, { toDate: addDays(from, -1) });
    await staff(p1.id, eve.employeeId);
    expect(
      (await hr.agent.patch(`${api}/projects/${finished.id}`).send({ status: 'done' })).status,
    ).toBe(200);

    await milestone(p1.id, 'Beta release', addDays(from, 1));
    await milestone(p1.id, 'Edge start', from);
    await milestone(p1.id, 'Edge end', to);
    await milestone(p1.id, 'Too early', addDays(from, -1));
    await milestone(p1.id, 'Too late', addDays(to, 1));
    const done = await milestone(p1.id, 'Already done', addDays(from, 2));
    expect(
      (
        await hr.agent
          .patch(`${api}/projects/${p1.id}/milestones/${done.id}`)
          .send({ status: 'done' })
      ).status,
    ).toBe(200);
    await milestone(later.id, 'Not on a project of the leave', addDays(from, 1));

    await task(p1.id, { assigneeEmployeeId: dan.employeeId, dueDate: from }); // a conflict
    await task(p1.id, { assigneeEmployeeId: dan.employeeId, dueDate: to }); // the last day counts
    await task(p1.id, { assigneeEmployeeId: dan.employeeId, dueDate: addDays(to, 1) });
    await task(p1.id, { assigneeEmployeeId: eve.employeeId, dueDate: from }); // somebody else's
    await task(p1.id, { dueDate: from }); // nobody's
    await task(p1.id, {
      assigneeEmployeeId: dan.employeeId,
      dueDate: from,
      status: 'done',
    }); // finished

    const types = (await dan.agent.get(`${api}/leave/types`)).body as { id: string; key: string }[];
    const created = await dan.agent.post(`${api}/leave/requests`).send({
      leaveTypeId: types.find((t) => t.key === 'unpaid')!.id,
      startDate: from,
      endDate: to,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    requestId = (created.body as { id: string }).id;
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  it('lists what the absence collides with: projects, milestones and tasks, nothing else', async () => {
    const c = await conflictsOf(hr);
    expect(c.assignments.map((a) => [a.name, a.allocationPct])).toEqual([
      ['Alpha', 30],
      ['Beta', 30],
      ['Ends on start', 30],
    ]); // not the project starting after, the finished one, or the one that ended the day before
    expect(c.milestones.map((m) => m.title)).toEqual(['Edge start', 'Beta release', 'Edge end']);
    expect(c.tasks.map((t) => [t.key, t.dueDate])).toEqual([
      [`${p1.code}-1`, from],
      [`${p1.code}-2`, to],
    ]);
    expect(JSON.stringify(c)).not.toContain('Secret task title');
  });

  it('counts an assignment that starts on the last day, and one that ended the day before', async () => {
    const types = (await dan.agent.get(`${api}/leave/types`)).body as { id: string; key: string }[];
    const unpaid = types.find((t) => t.key === 'unpaid')!.id;
    const on = addDays(to, 1); // the day "Later" starts
    const res = await dan.agent
      .post(`${api}/leave/requests`)
      .send({ leaveTypeId: unpaid, startDate: on, endDate: on });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const c = leaveConflictsSchema.parse(
      (await conflictsFor(hr, (res.body as { id: string }).id)).body,
    );
    expect(c.assignments.map((a) => a.name)).toEqual(['Alpha', 'Beta', 'Later']);
    expect(c.milestones.map((m) => m.title)).toEqual(['Too late']);
    expect(c.tasks.map((t) => t.dueDate)).toEqual([on]);
  });

  it('shows the manager what the manager may see, which here is the same', async () => {
    const c = await conflictsOf(mia);
    expect(c.assignments.map((a) => a.name)).toEqual(['Alpha', 'Beta', 'Ends on start']);
    expect(c.milestones).toHaveLength(3);
    expect(c.tasks).toHaveLength(2);
  });

  it('shows an approver without project or task access no warnings at all', async () => {
    const blind = await onboard(acme, 'blind');
    const role = await system.role.create({
      data: {
        tenantId: acme.tenantId,
        name: 'Leave approver',
        permissions: {
          create: [
            { permissionCode: 'leave.approve', scope: 'all' },
            { permissionCode: 'leave.view', scope: 'all' },
          ],
        },
      },
    });
    const granted = await acme.admin.agent
      .put(`${api}/users/${blind.id}/roles`)
      .send({ roleIds: [role.id] });
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);
    expect(await conflictsOf(blind)).toEqual({ assignments: [], milestones: [], tasks: [] });
  });

  it('is for approvers of that person only', async () => {
    for (const who of [ron, eve, dan]) {
      const res = await conflictsFor(who);
      expect([404, 403], who.email).toContain(res.status);
      expect(res.status === 404 || errorBody(res).code === 'FORBIDDEN').toBe(true);
    }
    const unknown = await conflictsFor(hr, UNKNOWN);
    expect([unknown.status, errorBody(unknown).code]).toEqual([404, 'NOT_FOUND']);
    expect((await conflictsFor(hr, 'not-an-id')).status).toBe(400);
  });

  it('shows another workspace nothing', async () => {
    const res = await conflictsFor(globex.admin);
    expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
  });

  it('warns without blocking: the request can still be approved', async () => {
    const res = await mia.agent.post(`${api}/leave/requests/${requestId}/approve`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await conflictsOf(hr)).assignments).toHaveLength(3); // still readable afterwards
  });
});
