import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  assignmentSchema,
  employeeSchema,
  milestoneSchema,
  personalDataExportSchema,
  projectDetailSchema,
  taskListSchema,
  taskSchema,
  todayIn,
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

describe.skipIf(!urls)('tasks over HTTP (real database)', () => {
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
  let mia: Person; // manager, leads "ofMia"
  let ron: Person; // manager, unrelated
  let dan: Person; // reports to mia, staffed on both projects
  let eve: Person; // staffed on "ofMia"
  let gus: Person; // unrelated employee
  let ofMia: { id: string; code: string };
  let ofHr: { id: string; code: string };

  const today = todayIn(ZONE);
  const asTenant = <T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>) =>
    app.get(TenantContext).run(tenantId, () => app.get(TenantDb).tx(fn));
  let counter = 0;

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
  const makeProject = async (who: Member, lead: string, name: string) => {
    const res = await who.agent.post(`${api}/projects`).send({
      code: `T${String(++counter).padStart(3, '0')}`,
      name,
      startDate: addDays(today, -30),
      status: 'active',
      leadEmployeeId: lead,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return projectDetailSchema.parse(res.body);
  };
  const staff = async (project: string, employeeId: string) => {
    const res = await hr.agent
      .post(`${api}/projects/${project}/assignments`)
      .send({ employeeId, allocationPct: 20, fromDate: addDays(today, -30) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return assignmentSchema.parse(res.body);
  };
  const create = (who: Member, projectId: string, body: object = {}) =>
    who.agent.post(`${api}/projects/${projectId}/tasks`).send({ title: 'Fix the login', ...body });
  const made = async (who: Member, projectId: string, body: object = {}) => {
    const res = await create(who, projectId, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return taskSchema.parse(res.body);
  };
  const patch = (who: Member, id: string, body: object) =>
    who.agent.patch(`${api}/tasks/${id}`).send(body);
  const open = (who: Member, id: string) => who.agent.get(`${api}/tasks/${id}`);
  const listOf = async (who: Member, query: object = {}) => {
    const res = await who.agent.get(`${api}/tasks`).query({ pageSize: 200, ...query });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return taskListSchema.parse(res.body);
  };
  const ids = async (who: Member, query: object = {}) =>
    (await listOf(who, query)).items.map((t) => t.id);
  const notesOf = async (who: Member) => {
    await app.get(OutboxWorker).runOnce();
    return (await who.agent.get(`${api}/notifications`)).body.items as {
      type: string;
      params: Record<string, unknown>;
    }[];
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
    gus = await onboard(acme, 'gus');
    const manage = await acme.admin.agent
      .put(`${api}/org/employees/${dan.employeeId}/assignment`)
      .send({ managerId: mia.employeeId, departmentId: null });
    expect(manage.status).toBe(204);
    ofMia = await makeProject(hr, mia.employeeId, 'Led by Mia');
    ofHr = await makeProject(hr, hr.employeeId, 'Led by HR');
    for (const p of [ofMia, ofHr]) await staff(p.id, dan.employeeId);
    await staff(ofMia.id, eve.employeeId);
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe('creating tasks', () => {
    it('numbers tasks per project and gives every field back, with the defaults', async () => {
      const project = await makeProject(hr, mia.employeeId, 'Numbering');
      const first = await made(mia, project.id, { title: ' First ' });
      expect(first).toMatchObject({
        key: `${project.code}-1`,
        number: 1,
        title: 'First',
        type: 'functional',
        status: 'todo',
        priority: 'normal',
        assignee: null,
        milestone: null,
        estimateHours: null,
        dueDate: null,
        doneOn: null,
        overdue: false,
        canEdit: true,
        canMove: true,
        project: { id: project.id, code: project.code },
      });
      const second = await made(hr, project.id, {});
      expect(second.key).toBe(`${project.code}-2`);
      const other = await made(hr, ofHr.id, {});
      expect(other.number).toBe(await system.task.count({ where: { projectId: ofHr.id } }));
    });

    it('takes every field: type, priority, milestone, assignee, estimate and due date', async () => {
      const project = await makeProject(hr, mia.employeeId, 'Full');
      await staff(project.id, dan.employeeId);
      const m = milestoneSchema.parse(
        (
          await mia.agent
            .post(`${api}/projects/${project.id}/milestones`)
            .send({ title: 'Beta', dueDate: addDays(today, 20) })
        ).body,
      );
      const task = await made(mia, project.id, {
        title: 'Rate limiting',
        description: ' per tenant ',
        type: 'non_functional',
        priority: 'high',
        milestoneId: m.id,
        assigneeEmployeeId: dan.employeeId,
        estimateHours: 7.5,
        dueDate: addDays(today, 5),
      });
      expect(task).toMatchObject({
        description: 'per tenant',
        type: 'non_functional',
        priority: 'high',
        milestone: { id: m.id, title: 'Beta' },
        assignee: { id: dan.employeeId, firstName: 'dan' },
        estimateHours: 7.5,
        dueDate: addDays(today, 5),
      });
    });

    it('lets the project lead, HR and Admin create; nobody else', async () => {
      expect((await create(mia, ofMia.id)).status).toBe(201);
      expect((await create(hr, ofMia.id)).status).toBe(201);
      expect((await create(acme.admin, ofMia.id)).status).toBe(201);
      for (const [who, target, status] of [
        [dan, ofMia.id, 403], // staffed but not the lead
        [eve, ofMia.id, 403],
        [mia, ofHr.id, 403], // sees it through dan, does not lead it
        [ron, ofMia.id, 404], // cannot even see the project
        [gus, ofMia.id, 404],
      ] as const) {
        const res = await create(who, target);
        expect([res.status, errorBody(res).code], `${who.id}`).toEqual([
          status,
          status === 403 ? 'FORBIDDEN' : 'NOT_FOUND',
        ]);
      }
      expect((await create(hr, UNKNOWN)).status).toBe(404);
      expect((await hr.agent.post(`${api}/projects/nope/tasks`).send({ title: 'x' })).status).toBe(
        400,
      );
    });

    it.each([
      ['no title', { title: ' ' }],
      ['a long title', { title: 'x'.repeat(121) }],
      ['a long description', { description: 'x'.repeat(2001) }],
      ['an unknown type', { type: 'bug' }],
      ['an unknown status', { status: 'blocked' }],
      ['an unknown priority', { priority: 'urgent' }],
      ['an estimate in odd fractions', { estimateHours: 1.3 }],
      ['a negative estimate', { estimateHours: -2 }],
      ['a bad date', { dueDate: '1.12.2026' }],
      ['a forged number', { number: 99 }],
      ['a forged done date', { doneOn: today }],
    ])('rejects %s', async (_label, body) => {
      const res = await create(hr, ofHr.id, body);
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('accepts an assignee who is staffed or leads, refuses everybody else', async () => {
      const project = await makeProject(hr, mia.employeeId, 'Assignees');
      await staff(project.id, dan.employeeId);
      expect((await create(mia, project.id, { assigneeEmployeeId: dan.employeeId })).status).toBe(
        201,
      );
      expect((await create(mia, project.id, { assigneeEmployeeId: mia.employeeId })).status).toBe(
        201,
      ); // the lead
      const outsider = await create(mia, project.id, { assigneeEmployeeId: gus.employeeId });
      expect([outsider.status, errorBody(outsider).details?.[0]?.code]).toEqual([
        400,
        'assignee_not_on_project',
      ]);
      const unknown = await create(mia, project.id, { assigneeEmployeeId: UNKNOWN });
      expect([unknown.status, errorBody(unknown).details?.[0]?.code]).toEqual([
        400,
        'unknown_employee',
      ]);
    });

    it('accepts milestones of the same project only', async () => {
      const project = await makeProject(hr, mia.employeeId, 'Milestones');
      const m = milestoneSchema.parse(
        (
          await mia.agent
            .post(`${api}/projects/${project.id}/milestones`)
            .send({ title: 'M', dueDate: today })
        ).body,
      );
      const elsewhere = milestoneSchema.parse(
        (
          await hr.agent
            .post(`${api}/projects/${ofHr.id}/milestones`)
            .send({ title: 'Other', dueDate: today })
        ).body,
      );
      expect((await create(mia, project.id, { milestoneId: m.id })).status).toBe(201);
      for (const id of [elsewhere.id, UNKNOWN]) {
        const res = await create(mia, project.id, { milestoneId: id });
        expect([res.status, errorBody(res).details?.[0]?.code]).toEqual([
          400,
          'milestone_not_in_project',
        ]);
      }
    });

    it('stays unique and gapless-enough when many are created at once', async () => {
      const project = await makeProject(hr, mia.employeeId, 'Race');
      const results = await Promise.all(Array.from({ length: 6 }, () => create(mia, project.id)));
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
      const numbers = (
        await system.task.findMany({ where: { projectId: project.id }, select: { number: true } })
      )
        .map((t) => t.number)
        .sort();
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('records the finish date when created as done', async () => {
      const task = await made(hr, ofHr.id, { status: 'done' });
      expect(task).toMatchObject({ status: 'done', doneOn: today });
    });

    it('tells the assignee (by reference, not title), but not somebody who gives themselves a task', async () => {
      const project = await makeProject(hr, mia.employeeId, 'Notify');
      await staff(project.id, dan.employeeId);
      const secret = 'Secret redesign of payroll';
      const task = await made(mia, project.id, {
        title: secret,
        assigneeEmployeeId: dan.employeeId,
      });
      await made(mia, project.id, { assigneeEmployeeId: mia.employeeId });
      const forDan = (await notesOf(dan)).filter((n) => n.type === 'task.assigned');
      expect(forDan.find((n) => n.params.projectId === project.id)?.params).toEqual({
        projectId: project.id,
        taskKey: task.key,
      });
      expect(JSON.stringify(forDan)).not.toContain('payroll');
      expect((await notesOf(mia)).filter((n) => n.type === 'task.assigned')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('changing tasks', () => {
    it('lets the lead change every field and clear optional ones', async () => {
      const task = await made(mia, ofMia.id, {
        assigneeEmployeeId: dan.employeeId,
        estimateHours: 4,
        dueDate: addDays(today, 3),
        description: 'x',
      });
      const changed = await patch(mia, task.id, {
        title: 'Renamed',
        type: 'non_functional',
        priority: 'low',
        assigneeEmployeeId: eve.employeeId,
        estimateHours: 2.5,
        dueDate: addDays(today, 9),
      });
      expect(taskSchema.parse(changed.body)).toMatchObject({
        title: 'Renamed',
        type: 'non_functional',
        priority: 'low',
        assignee: { id: eve.employeeId },
        estimateHours: 2.5,
        dueDate: addDays(today, 9),
      });
      const cleared = await patch(mia, task.id, {
        assigneeEmployeeId: null,
        estimateHours: null,
        dueDate: null,
        description: ' ',
        milestoneId: null,
      });
      expect(taskSchema.parse(cleared.body)).toMatchObject({
        assignee: null,
        estimateHours: null,
        dueDate: null,
        description: null,
        milestone: null,
      });
    });

    it('sets the finish date when done and clears it when reopened, and flags overdue ones', async () => {
      const task = await made(mia, ofMia.id, { dueDate: addDays(today, -2) });
      expect(task.overdue).toBe(true);
      const done = taskSchema.parse((await patch(mia, task.id, { status: 'done' })).body);
      expect(done).toMatchObject({ status: 'done', doneOn: today, overdue: false });
      const again = taskSchema.parse((await patch(mia, task.id, { status: 'done' })).body);
      expect(again.doneOn).toBe(today);
      const reopened = taskSchema.parse((await patch(mia, task.id, { status: 'review' })).body);
      expect(reopened).toMatchObject({ status: 'review', doneOn: null, overdue: true });
    });

    it('lets the assignee move their own task, and only move it', async () => {
      const task = await made(mia, ofMia.id, { assigneeEmployeeId: dan.employeeId });
      const seen = taskSchema.parse((await open(dan, task.id)).body);
      expect(seen).toMatchObject({ canEdit: false, canMove: true });
      expect(
        taskSchema.parse((await patch(dan, task.id, { status: 'in_progress' })).body).status,
      ).toBe('in_progress');
      for (const body of [
        { status: 'done', title: 'x' },
        { title: 'x' },
        { assigneeEmployeeId: null },
        { dueDate: addDays(today, 40) },
      ]) {
        const res = await patch(dan, task.id, body);
        expect([res.status, errorBody(res).code], JSON.stringify(body)).toEqual([403, 'FORBIDDEN']);
      }
      expect((await system.task.findUniqueOrThrow({ where: { id: task.id } })).title).toBe(
        'Fix the login',
      );
    });

    it('does not let others move it: staffed colleagues, other managers, strangers', async () => {
      const task = await made(mia, ofMia.id, { assigneeEmployeeId: dan.employeeId });
      const seenByEve = taskSchema.parse((await open(eve, task.id)).body);
      expect(seenByEve).toMatchObject({ canEdit: false, canMove: false });
      const res = await patch(eve, task.id, { status: 'done' });
      expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      for (const who of [ron, gus]) {
        expect((await patch(who, task.id, { status: 'done' })).status).toBe(404);
      }
      const mine = await made(mia, ofMia.id, {});
      expect((await patch(dan, mine.id, { status: 'done' })).status).toBe(403); // not assigned to dan
      // a manager who does not lead the project cannot edit either
      const hrs = await made(hr, ofHr.id, { assigneeEmployeeId: dan.employeeId });
      expect((await patch(mia, hrs.id, { title: 'mine now' })).status).toBe(403);
    });

    it('tells a new assignee, not the same one again, and refuses people outside the project', async () => {
      const project = await makeProject(hr, mia.employeeId, 'Reassign');
      await staff(project.id, dan.employeeId);
      await staff(project.id, eve.employeeId);
      const task = await made(mia, project.id, { assigneeEmployeeId: dan.employeeId });
      await patch(mia, task.id, { assigneeEmployeeId: eve.employeeId });
      await patch(mia, task.id, { assigneeEmployeeId: eve.employeeId, priority: 'high' });
      const forEve = (await notesOf(eve)).filter(
        (n) => n.type === 'task.assigned' && n.params.taskKey === task.key,
      );
      expect(forEve).toHaveLength(1);
      const outsider = await patch(mia, task.id, { assigneeEmployeeId: gus.employeeId });
      expect([outsider.status, errorBody(outsider).details?.[0]?.code]).toEqual([
        400,
        'assignee_not_on_project',
      ]);
      const elsewhere = milestoneSchema.parse(
        (
          await hr.agent
            .post(`${api}/projects/${ofHr.id}/milestones`)
            .send({ title: 'O', dueDate: today })
        ).body,
      );
      const wrong = await patch(mia, task.id, { milestoneId: elsewhere.id });
      expect([wrong.status, errorBody(wrong).details?.[0]?.code]).toEqual([
        400,
        'milestone_not_in_project',
      ]);
    });

    it.each([
      ['an empty change', {}],
      ['an unknown status', { status: 'blocked' }],
      ['a forged number', { number: 3 }],
      ['another project', { projectId: UNKNOWN }],
      ['a long title', { title: 'x'.repeat(121) }],
      ['an estimate in odd fractions', { estimateHours: 0.3 }],
    ])('rejects %s', async (_label, body) => {
      const task = await made(mia, ofMia.id);
      const res = await patch(mia, task.id, body);
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('finds nothing for unknown ids', async () => {
      expect((await patch(hr, UNKNOWN, { status: 'done' })).status).toBe(404);
      expect((await patch(hr, 'nope', { status: 'done' })).status).toBe(400);
      expect((await open(hr, UNKNOWN)).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('who sees which tasks, and filtering', () => {
    it('shows people the tasks of their projects, managers also those of their people', async () => {
      const a = await made(mia, ofMia.id, { title: 'On the project of Mia' });
      const b = await made(hr, ofHr.id, {
        title: 'On the project of HR',
        assigneeEmployeeId: dan.employeeId,
      });
      const c = await made(hr, ofHr.id, { title: 'Only HR project, nobody of Mia' });
      expect(await ids(dan)).toEqual(expect.arrayContaining([a.id, b.id, c.id])); // staffed on both
      expect(await ids(eve)).toContain(a.id);
      expect(await ids(eve)).not.toContain(b.id);
      expect(await ids(mia)).toEqual(expect.arrayContaining([a.id, b.id])); // leads one, dan staffed on the other
      for (const who of [ron, gus]) {
        const mine = await ids(who);
        for (const id of [a.id, b.id, c.id]) expect(mine).not.toContain(id);
        expect((await open(who, a.id)).status).toBe(404);
      }
      for (const who of [hr, acme.admin])
        expect(await ids(who)).toEqual(expect.arrayContaining([a.id, b.id, c.id]));
    });

    it('filters by project, assignee, status, type and search, and pages', async () => {
      const project = await makeProject(hr, mia.employeeId, 'Filtering');
      await staff(project.id, dan.employeeId);
      const t1 = await made(mia, project.id, {
        title: 'Alpha login',
        assigneeEmployeeId: dan.employeeId,
        status: 'in_progress',
      });
      const t2 = await made(mia, project.id, {
        title: 'Beta export',
        type: 'non_functional',
        status: 'done',
      });
      const t3 = await made(mia, project.id, {
        title: 'Gamma 100% sure',
        assigneeEmployeeId: mia.employeeId,
      });
      expect((await ids(mia, { projectId: project.id })).sort()).toEqual(
        [t1.id, t2.id, t3.id].sort(),
      );
      expect(await ids(mia, { projectId: project.id, assignee: 'none' })).toEqual([t2.id]);
      expect(await ids(dan, { projectId: project.id, assignee: 'me' })).toEqual([t1.id]);
      expect(await ids(mia, { projectId: project.id, assignee: dan.employeeId })).toEqual([t1.id]);
      expect(await ids(mia, { projectId: project.id, status: 'done' })).toEqual([t2.id]);
      expect((await ids(mia, { projectId: project.id, status: 'open' })).sort()).toEqual(
        [t1.id, t3.id].sort(),
      );
      expect(await ids(mia, { projectId: project.id, type: 'non_functional' })).toEqual([t2.id]);
      expect(await ids(mia, { projectId: project.id, q: 'EXPORT' })).toEqual([t2.id]);
      expect(await ids(mia, { projectId: project.id, q: t3.key.toLowerCase() })).toEqual([t3.id]);
      expect(await ids(mia, { projectId: project.id, q: '100%' })).toEqual([t3.id]);
      expect(await ids(mia, { projectId: project.id, q: '%' })).toEqual([t3.id]); // % is not a wildcard
      const page = taskListSchema.parse(
        (await mia.agent.get(`${api}/tasks`).query({ projectId: project.id, pageSize: 2, page: 2 }))
          .body,
      );
      expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(page.items).toHaveLength(1);
      for (const query of [
        { assignee: 'everyone' },
        { status: 'x' },
        { type: 'x' },
        { projectId: 'x' },
        { pageSize: 201 },
      ]) {
        const res = await mia.agent.get(`${api}/tasks`).query(query);
        expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('deleting, leavers, export and audit', () => {
    it('deletes for the lead and HR, not for the assignee or others', async () => {
      const task = await made(mia, ofMia.id, { assigneeEmployeeId: dan.employeeId });
      for (const who of [dan, eve]) {
        const res = await who.agent.delete(`${api}/tasks/${task.id}`);
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      }
      expect((await ron.agent.delete(`${api}/tasks/${task.id}`)).status).toBe(404);
      expect((await mia.agent.delete(`${api}/tasks/${task.id}`)).status).toBe(204);
      expect((await mia.agent.delete(`${api}/tasks/${task.id}`)).status).toBe(404);
      const other = await made(mia, ofMia.id);
      expect((await hr.agent.delete(`${api}/tasks/${other.id}`)).status).toBe(204);
    });

    it('frees the open tasks of a deactivated employee but keeps finished ones', async () => {
      const leaver = await onboard(acme, 'leaver');
      const project = await makeProject(hr, hr.employeeId, 'Leaver');
      await staff(project.id, leaver.employeeId);
      const open1 = await made(hr, project.id, { assigneeEmployeeId: leaver.employeeId });
      const review = await made(hr, project.id, {
        assigneeEmployeeId: leaver.employeeId,
        status: 'review',
      });
      const finished = await made(hr, project.id, {
        assigneeEmployeeId: leaver.employeeId,
        status: 'done',
      });
      expect(
        (
          await hr.agent
            .post(`${api}/employees/${leaver.employeeId}/deactivate`)
            .send({ terminationDate: today })
        ).status,
      ).toBe(200);
      const owner = async (id: string) =>
        (await system.task.findUniqueOrThrow({ where: { id } })).assigneeEmployeeId;
      expect(await owner(open1.id)).toBeNull();
      expect(await owner(review.id)).toBeNull();
      expect(await owner(finished.id)).toBe(leaver.employeeId);
      const again = await create(hr, project.id, { assigneeEmployeeId: leaver.employeeId });
      expect([again.status, errorBody(again).details?.[0]?.code]).toEqual([
        400,
        'unknown_employee',
      ]);
    });

    it('appears in the data export of the assignee', async () => {
      const task = await made(mia, ofMia.id, {
        title: 'Exported task',
        assigneeEmployeeId: eve.employeeId,
        estimateHours: 3,
        dueDate: addDays(today, 4),
      });
      const doc = personalDataExportSchema.parse(
        (await eve.agent.get(`${api}/privacy/export`)).body,
      );
      expect(doc.tasks).toContainEqual({
        key: task.key,
        title: 'Exported task',
        status: 'todo',
        estimateHours: 3,
        dueDate: addDays(today, 4),
      });
    });

    it('audits with ids and field names, never the text', async () => {
      const secret = 'Confidential codename Phoenix';
      const task = await made(mia, ofMia.id, { title: secret, description: secret });
      await patch(mia, task.id, { title: `${secret} v2` });
      await mia.agent.delete(`${api}/tasks/${task.id}`);
      const logs = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, entityId: task.id },
      });
      expect(logs.map((l) => l.action).sort()).toEqual([
        'task.created',
        'task.deleted',
        'task.updated',
      ]);
      expect(
        JSON.stringify(
          await system.auditLog.findMany({ where: { tenantId: acme.tenantId, entity: 'task' } }),
        ),
      ).not.toContain('Phoenix');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('tenant isolation and database rules', () => {
    it('keeps another workspace away from tasks, in lists and in every write', async () => {
      const task = await made(hr, ofHr.id, { title: 'Internal' });
      const g = globex.admin;
      expect(await ids(g)).not.toContain(task.id);
      for (const res of [
        await open(g, task.id),
        await patch(g, task.id, { title: 'x' }),
        await g.agent.delete(`${api}/tasks/${task.id}`),
        await create(g, ofHr.id),
      ]) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      expect(
        await asTenant(globex.tenantId, (tx) => tx.task.findUnique({ where: { id: task.id } })),
      ).toBeNull();
      expect(
        await asTenant(globex.tenantId, (tx) => tx.task.deleteMany({ where: { id: task.id } })),
      ).toEqual({ count: 0 });
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.task.updateMany({ where: { id: task.id }, data: { title: 'x' } }),
        ),
      ).toEqual({ count: 0 });
      await expect(
        asTenant(globex.tenantId, (tx) =>
          tx.task.create({
            data: { tenantId: acme.tenantId, projectId: ofHr.id, number: 999, title: 'Smuggled' },
          }),
        ),
      ).rejects.toThrow();
    });

    it('enforces the rules in the database when the application is bypassed', async () => {
      const m = milestoneSchema.parse(
        (
          await hr.agent
            .post(`${api}/projects/${ofHr.id}/milestones`)
            .send({ title: 'Mine', dueDate: today })
        ).body,
      );
      const base = { tenantId: acme.tenantId, projectId: ofMia.id, title: 'Rules' };
      let n = 5000;
      const next = () => ++n;
      const refuse = (data: object) =>
        expect(
          system.task.create({ data: { ...base, number: next(), ...data } }),
        ).rejects.toThrow();
      await refuse({ type: 'bug' });
      await refuse({ status: 'blocked' });
      await refuse({ priority: 'urgent' });
      await refuse({ title: '' });
      await refuse({ title: 'x'.repeat(121) });
      await refuse({ description: 'x'.repeat(2001) });
      await refuse({ estimateHours: -1 });
      await refuse({ estimateHours: 1000.5 });
      await refuse({ status: 'done' }); // done without a finish date
      await refuse({ doneOn: new Date() }); // a finish date while open
      await refuse({ milestoneId: m.id }); // a milestone of another project
      await expect(system.task.create({ data: { ...base, number: 0 } })).rejects.toThrow();
      const ok = await system.task.create({ data: { ...base, number: next() } });
      await expect(system.task.create({ data: { ...base, number: ok.number } })).rejects.toThrow(); // duplicate number
      await expect(
        system.task.update({ where: { id: ok.id }, data: { milestoneId: m.id } }),
      ).rejects.toThrow(); // moving it later
      const foreign = await system.employee.findFirstOrThrow({
        where: { tenantId: globex.tenantId },
      });
      await expect(
        system.task.create({ data: { ...base, number: next(), assigneeEmployeeId: foreign.id } }),
      ).rejects.toThrow(); // an assignee of another workspace
    });
  });
});
