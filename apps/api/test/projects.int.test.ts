import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  assignmentSchema,
  clientListSchema,
  clientSchema,
  employeeSchema,
  milestoneSchema,
  personalDataExportSchema,
  projectDetailSchema,
  projectListSchema,
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

describe.skipIf(!urls)('clients and projects over HTTP (real database)', () => {
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
  let ron: Person; // another manager, nobody's boss
  let dan: Person; // reports to mia
  let eve: Person; // unrelated employee
  let gus: Person; // another unrelated employee

  const today = todayIn(ZONE);
  const asTenant = <T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>) =>
    app.get(TenantContext).run(tenantId, () => app.get(TenantDb).tx(fn));
  let counter = 0;
  const code = () => `P${String(++counter).padStart(3, '0')}`;

  async function onboard(
    ws: Workspace,
    name: string,
    role: SystemRole = 'employee',
  ): Promise<Person> {
    const email = `${name}@${ws === acme ? 'acme' : 'globex'}.eu`;
    const res = await ws.admin.agent
      .post('/api/v1/employees')
      .send({ firstName: name, lastName: 'Test', employmentType: 'full_time', email });
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

  const api = '/api/v1';
  const createClient = (who: Member, body: object) => who.agent.post(`${api}/clients`).send(body);
  const createProject = (who: Member, body: object = {}) =>
    who.agent
      .post(`${api}/projects`)
      .send({ code: code(), name: 'Website', startDate: today, ...body });
  const made = async (who: Member, body: object = {}) => {
    const res = await createProject(who, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return projectDetailSchema.parse(res.body);
  };
  const staff = (who: Member, projectId: string, body: object) =>
    who.agent.post(`${api}/projects/${projectId}/assignments`).send(body);
  const staffed = async (who: Member, projectId: string, body: object) => {
    const res = await staff(who, projectId, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return assignmentSchema.parse(res.body);
  };
  const open = async (who: Member, id: string) => {
    const res = await who.agent.get(`${api}/projects/${id}`);
    return res;
  };
  const listIds = async (who: Member, query: object = {}) => {
    const res = await who.agent.get(`${api}/projects`).query({ pageSize: 100, ...query });
    expect(res.status).toBe(200);
    return projectListSchema.parse(res.body).items.map((p) => p.id);
  };
  const notesOf = async (who: Member) => {
    await app.get(OutboxWorker).runOnce();
    return (await who.agent.get(`${api}/notifications`)).body.items as {
      type: string;
      params: Record<string, unknown>;
    }[];
  };
  const range = (from: number, to: number | null) => ({
    fromDate: addDays(today, from),
    ...(to === null ? {} : { toDate: addDays(today, to) }),
  });

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
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe('clients', () => {
    it('are created by HR, listed with their project count, and visible to managers', async () => {
      const res = await createClient(hr, {
        name: ' Initech ',
        contactName: 'Bill Lumbergh',
        contactEmail: 'Bill@Initech.EU',
        notes: ' key account ',
      });
      expect(res.status).toBe(201);
      const client = clientSchema.parse(res.body);
      expect(client).toMatchObject({
        name: 'Initech',
        contactEmail: 'bill@initech.eu',
        notes: 'key account',
        status: 'active',
        projectCount: 0,
      });
      await made(hr, { clientId: client.id });
      for (const who of [hr, mia, acme.admin]) {
        const list = clientListSchema.parse((await who.agent.get(`${api}/clients`)).body);
        expect(list.items.find((c) => c.id === client.id)?.projectCount).toBe(1);
      }
    });

    it('are for managers and above only to read, and for HR and Admin to change', async () => {
      for (const who of [dan, eve]) {
        const res = await who.agent.get(`${api}/clients`);
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      }
      for (const who of [mia, dan]) {
        const res = await createClient(who, { name: 'Nope' });
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      }
      expect((await createClient(acme.admin, { name: 'Admin client' })).status).toBe(201);
    });

    it('refuse duplicates (any letter case), bad input and unknown ids', async () => {
      expect((await createClient(hr, { name: 'Duplicate Ltd' })).status).toBe(201);
      const dup = await createClient(hr, { name: 'duplicate LTD' });
      expect([dup.status, errorBody(dup).params]).toEqual([409, { field: 'name' }]);
      for (const body of [
        {},
        { name: ' ' },
        { name: 'x'.repeat(121) },
        { name: 'A', contactEmail: 'nope' },
        { name: 'A', status: 'archived' },
      ]) {
        const res = await createClient(hr, body);
        expect([res.status, errorBody(res).code], JSON.stringify(body)).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
      expect((await hr.agent.patch(`${api}/clients/${UNKNOWN}`).send({ notes: 'x' })).status).toBe(
        404,
      );
      expect((await hr.agent.patch(`${api}/clients/nope`).send({ notes: 'x' })).status).toBe(400);
    });

    it('can be changed, cleared and archived, and an archived client cannot get new projects', async () => {
      const client = clientSchema.parse(
        (await createClient(hr, { name: 'Archivable', notes: 'x' })).body,
      );
      const changed = await hr.agent
        .patch(`${api}/clients/${client.id}`)
        .send({ notes: ' ', name: 'Archivable 2' });
      expect(clientSchema.parse(changed.body)).toMatchObject({ name: 'Archivable 2', notes: null });
      const clash = await hr.agent.patch(`${api}/clients/${client.id}`).send({ name: 'INITECH' });
      expect([clash.status, errorBody(clash).params]).toEqual([409, { field: 'name' }]);
      const same = await hr.agent
        .patch(`${api}/clients/${client.id}`)
        .send({ name: 'archivable 2' }); // itself, other case
      expect(same.status).toBe(200);
      expect(
        (await hr.agent.patch(`${api}/clients/${client.id}`).send({ status: 'archived' })).status,
      ).toBe(200);
      const res = await createProject(hr, { clientId: client.id });
      expect([res.status, errorBody(res).params]).toEqual([409, { field: 'client' }]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('creating and changing projects', () => {
    it('are created by HR with every field, the code in capitals and health only when active', async () => {
      const client = clientSchema.parse((await createClient(hr, { name: 'Globex Corp' })).body);
      const project = await made(hr, {
        code: 'web-9',
        name: ' Relaunch ',
        description: ' New site ',
        clientId: client.id,
        status: 'active',
        priority: 'high',
        isBillable: false,
        budgetHours: 120.5,
        startDate: addDays(today, -10),
        endDate: addDays(today, 60),
        leadEmployeeId: mia.employeeId,
      });
      expect(project).toMatchObject({
        code: 'WEB-9',
        name: 'Relaunch',
        description: 'New site',
        client: { id: client.id, name: 'Globex Corp' },
        status: 'active',
        priority: 'high',
        isBillable: false,
        budgetHours: 120.5,
        endDate: addDays(today, 60),
        lead: { id: mia.employeeId, firstName: 'mia' },
        health: 'on_track',
        canEdit: true,
        canStaff: true,
        milestones: [],
        assignments: [],
      });
      const planned = await made(hr, {});
      expect(planned).toMatchObject({
        status: 'planned',
        priority: 'normal',
        isBillable: true,
        health: null,
        client: null,
        lead: null,
      });
    });

    it('refuse duplicate codes, bad input, unknown clients and leads', async () => {
      const first = await made(hr, { code: 'DUP-1' });
      const dup = await createProject(hr, { code: 'dup-1' });
      expect([dup.status, errorBody(dup).params]).toEqual([409, { field: 'code' }]);
      expect(first.code).toBe('DUP-1');
      for (const patch of [
        { code: 'A' },
        { code: 'has space' },
        { name: ' ' },
        { status: 'cancelled' },
        { budgetHours: -1 },
        { endDate: addDays(today, -5) },
        { startDate: 'x' },
        { health: 'on_track' },
      ]) {
        const res = await createProject(hr, patch);
        expect([res.status, errorBody(res).code], JSON.stringify(patch)).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
      const noClient = await createProject(hr, { clientId: UNKNOWN });
      expect([noClient.status, errorBody(noClient).details?.[0]?.code]).toEqual([
        400,
        'unknown_client',
      ]);
      const noLead = await createProject(hr, { leadEmployeeId: UNKNOWN });
      expect([noLead.status, errorBody(noLead).details?.[0]?.code]).toEqual([
        400,
        'unknown_employee',
      ]);
    });

    it('lets managers create projects they lead themselves, never for somebody else', async () => {
      const own = await made(mia, { leadEmployeeId: undefined });
      expect(own.lead?.id).toBe(mia.employeeId);
      expect(own).toMatchObject({ canEdit: true, canStaff: true });
      const other = await createProject(mia, { leadEmployeeId: ron.employeeId });
      expect([other.status, errorBody(other).code]).toEqual([403, 'FORBIDDEN']);
      const self = await createProject(mia, { leadEmployeeId: mia.employeeId });
      expect(self.status).toBe(201);
    });

    it('cannot be created by employees', async () => {
      const res = await createProject(dan);
      expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
    });

    it('can be changed by the lead and HR; only HR changes the lead', async () => {
      const project = await made(mia, {});
      const changed = await mia.agent.patch(`${api}/projects/${project.id}`).send({
        name: 'Renamed',
        status: 'active',
        description: ' ',
        endDate: addDays(today, 30),
        budgetHours: 10,
      });
      expect(projectDetailSchema.parse(changed.body)).toMatchObject({
        name: 'Renamed',
        status: 'active',
        description: null,
        endDate: addDays(today, 30),
        budgetHours: 10,
        health: 'on_track',
      });
      const cleared = await mia.agent
        .patch(`${api}/projects/${project.id}`)
        .send({ endDate: null, budgetHours: null });
      expect(projectDetailSchema.parse(cleared.body)).toMatchObject({
        endDate: null,
        budgetHours: null,
      });
      const handOver = await mia.agent
        .patch(`${api}/projects/${project.id}`)
        .send({ leadEmployeeId: ron.employeeId });
      expect([handOver.status, errorBody(handOver).code]).toEqual([403, 'FORBIDDEN']);
      const byHr = await hr.agent
        .patch(`${api}/projects/${project.id}`)
        .send({ leadEmployeeId: ron.employeeId });
      expect(projectDetailSchema.parse(byHr.body).lead?.id).toBe(ron.employeeId);
      // mia no longer leads it: she may still see nothing of it unless her people work on it
      expect((await open(mia, project.id)).status).toBe(404);
      expect(
        (await hr.agent.patch(`${api}/projects/${project.id}`).send({ leadEmployeeId: null }))
          .status,
      ).toBe(200);
    });

    it('refuse bad changes and clashes, and do not touch the project then', async () => {
      const a = await made(hr, { startDate: addDays(today, 5) });
      const b = await made(hr, {});
      const clash = await hr.agent
        .patch(`${api}/projects/${b.id}`)
        .send({ code: a.code.toLowerCase() });
      expect([clash.status, errorBody(clash).params]).toEqual([409, { field: 'code' }]);
      for (const body of [
        {},
        { endDate: addDays(today, 1) },
        { code: '!' },
        { status: 'x' },
        { id: UNKNOWN },
      ]) {
        const res = await hr.agent.patch(`${api}/projects/${a.id}`).send(body);
        expect([res.status, errorBody(res).code], JSON.stringify(body)).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
      expect((await hr.agent.patch(`${api}/projects/${UNKNOWN}`).send({ name: 'x' })).status).toBe(
        404,
      );
      expect(projectDetailSchema.parse((await open(hr, a.id)).body)).toMatchObject({
        name: 'Website',
        endDate: null,
      });
    });

    it('lets employees see their projects but not change anything', async () => {
      const project = await made(hr, { leadEmployeeId: hr.employeeId });
      await staffed(hr, project.id, {
        employeeId: dan.employeeId,
        allocationPct: 50,
        ...range(0, null),
      });
      for (const res of [
        await dan.agent.patch(`${api}/projects/${project.id}`).send({ name: 'Mine now' }),
        await dan.agent
          .post(`${api}/projects/${project.id}/milestones`)
          .send({ title: 'x', dueDate: today }),
        await staff(dan, project.id, {
          employeeId: dan.employeeId,
          allocationPct: 10,
          ...range(0, null),
        }),
      ]) {
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      }
      const seen = projectDetailSchema.parse((await open(dan, project.id)).body);
      expect(seen).toMatchObject({ canEdit: false, canStaff: false });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('who sees which projects', () => {
    it('shows employees only the projects they work on, managers also those of their people', async () => {
      const client = clientSchema.parse((await createClient(hr, { name: 'Visibility Inc' })).body);
      const ofDan = await made(hr, { clientId: client.id, leadEmployeeId: hr.employeeId });
      await staffed(hr, ofDan.id, {
        employeeId: dan.employeeId,
        allocationPct: 40,
        ...range(0, null),
      });
      const ofEve = await made(hr, { leadEmployeeId: hr.employeeId });
      await staffed(hr, ofEve.id, {
        employeeId: eve.employeeId,
        allocationPct: 40,
        ...range(0, null),
      });
      const nobody = await made(hr, {});

      const dans = await listIds(dan);
      expect(dans).toContain(ofDan.id);
      expect(dans).not.toContain(ofEve.id);
      expect(dans).not.toContain(nobody.id);
      expect((await open(dan, ofEve.id)).status).toBe(404);
      expect((await open(dan, nobody.id)).status).toBe(404);

      const mias = await listIds(mia); // dan reports to mia
      expect(mias).toContain(ofDan.id);
      expect(mias).not.toContain(ofEve.id);
      expect((await open(mia, ofEve.id)).status).toBe(404);
      expect(await listIds(ron)).not.toContain(ofDan.id);
      expect(await listIds(gus)).not.toContain(ofDan.id);

      const hrs = await listIds(hr);
      for (const id of [ofDan.id, ofEve.id, nobody.id]) expect(hrs).toContain(id);
      expect(await listIds(acme.admin)).toContain(nobody.id);
    });

    it('hides the client from people who may not see clients', async () => {
      const client = clientSchema.parse((await createClient(hr, { name: 'Hidden Client' })).body);
      const project = await made(hr, { clientId: client.id, leadEmployeeId: hr.employeeId });
      await staffed(hr, project.id, {
        employeeId: dan.employeeId,
        allocationPct: 20,
        ...range(0, null),
      });
      expect(projectDetailSchema.parse((await open(dan, project.id)).body).client).toBeNull();
      expect(projectDetailSchema.parse((await open(mia, project.id)).body).client).toMatchObject({
        name: 'Hidden Client',
      });
      expect(projectDetailSchema.parse((await open(hr, project.id)).body).client).toMatchObject({
        name: 'Hidden Client',
      });
      // an employee cannot filter by client either (that would reveal it)
      expect(await listIds(dan, { clientId: client.id })).toContain(project.id);
    });

    it('searches by name or code, filters by status and client, and pages', async () => {
      const needle = `Zebra${Date.now()}`;
      const a = await made(hr, { name: `${needle} alpha`, status: 'active' });
      const b = await made(hr, { name: `${needle} beta`, status: 'paused' });
      await made(hr, { name: 'Percent 100% done', code: 'PCT-1' });
      expect((await listIds(hr, { q: needle })).sort()).toEqual([a.id, b.id].sort());
      expect(await listIds(hr, { q: needle, status: 'paused' })).toEqual([b.id]);
      expect(await listIds(hr, { q: a.code.toLowerCase() })).toEqual([a.id]);
      expect(await listIds(hr, { q: '100%' })).toHaveLength(1); // % is not a wildcard
      expect(await listIds(hr, { q: '%' })).toHaveLength(1);
      const page = await hr.agent.get(`${api}/projects`).query({ q: needle, pageSize: 1, page: 2 });
      expect(projectListSchema.parse(page.body)).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      for (const query of [{ status: 'x' }, { pageSize: 101 }, { clientId: 'nope' }]) {
        const res = await hr.agent.get(`${api}/projects`).query(query);
        expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('staffing', () => {
    it('is done by the lead, HR and Admin, not by other managers or employees', async () => {
      const project = await made(mia, {});
      const fresh = await onboard(acme, `fresh${++counter}`);
      const a = await staffed(mia, project.id, {
        employeeId: fresh.employeeId,
        role: ' Backend ',
        allocationPct: 50,
        ...range(0, 30),
      });
      expect(a).toMatchObject({
        role: 'Backend',
        allocationPct: 50,
        overAllocated: false,
        employee: { id: fresh.employeeId },
      });
      expect(
        (
          await staff(hr, project.id, {
            employeeId: eve.employeeId,
            allocationPct: 10,
            ...range(0, null),
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await staff(acme.admin, project.id, {
            employeeId: gus.employeeId,
            allocationPct: 10,
            ...range(0, null),
          })
        ).status,
      ).toBe(201);
      const others = await made(hr, { leadEmployeeId: hr.employeeId });
      await staffed(hr, others.id, {
        employeeId: dan.employeeId,
        allocationPct: 10,
        ...range(0, null),
      });
      for (const [who, target] of [
        [ron, project.id],
        [dan, project.id],
        [eve, project.id],
        [mia, others.id], // sees it through dan, but does not lead it
      ] as const) {
        const res = await staff(who, target, {
          employeeId: gus.employeeId,
          allocationPct: 10,
          ...range(0, null),
        });
        expect([404, 403], `${who.id}`).toContain(res.status);
        expect(res.status).not.toBe(201);
      }
      expect(
        errorBody(
          await staff(mia, others.id, {
            employeeId: gus.employeeId,
            allocationPct: 10,
            ...range(0, null),
          }),
        ).code,
      ).toBe('FORBIDDEN');
      expect(
        errorBody(
          await staff(ron, project.id, {
            employeeId: gus.employeeId,
            allocationPct: 10,
            ...range(0, null),
          }),
        ).code,
      ).toBe('NOT_FOUND');
    });

    it('refuses bad allocations, dates, people and projects', async () => {
      const project = await made(hr, {});
      const base = { employeeId: dan.employeeId, allocationPct: 50, ...range(0, null) };
      for (const patch of [
        { allocationPct: 0 },
        { allocationPct: 101 },
        { allocationPct: 33.3 },
        { toDate: addDays(today, -1) },
        { role: 'x'.repeat(61) },
        { employeeId: 'nope' },
        { projectId: UNKNOWN },
      ]) {
        const res = await staff(hr, project.id, { ...base, ...patch });
        expect([res.status, errorBody(res).code], JSON.stringify(patch)).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
      const unknown = await staff(hr, project.id, { ...base, employeeId: UNKNOWN });
      expect([unknown.status, errorBody(unknown).details?.[0]?.code]).toEqual([
        400,
        'unknown_employee',
      ]);
      expect((await staff(hr, UNKNOWN, base)).status).toBe(404);
    });

    it('refuses the same person twice at the same time, but allows follow-up periods', async () => {
      const project = await made(hr, { leadEmployeeId: hr.employeeId });
      const first = await staffed(hr, project.id, {
        employeeId: gus.employeeId,
        allocationPct: 50,
        ...range(0, 10),
      });
      for (const [from, to] of [
        [5, 15],
        [-5, 0],
        [-5, 20],
        [10, 10],
        [3, 4],
      ] as const) {
        const res = await staff(hr, project.id, {
          employeeId: gus.employeeId,
          allocationPct: 20,
          ...range(from, to),
        });
        expect([res.status, errorBody(res).params], `${from}..${to}`).toEqual([
          409,
          { field: 'overlap' },
        ]);
      }
      const open = await staff(hr, project.id, {
        employeeId: gus.employeeId,
        allocationPct: 20,
        ...range(5, null),
      });
      expect(open.status).toBe(409); // an open end runs into the first period
      expect(
        (
          await staff(hr, project.id, {
            employeeId: gus.employeeId,
            allocationPct: 20,
            ...range(11, 20),
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await staff(hr, project.id, {
            employeeId: gus.employeeId,
            allocationPct: 20,
            ...range(-9, -1),
          })
        ).status,
      ).toBe(201);
      // moving the first period onto the follow-up is refused too
      const move = await hr.agent
        .patch(`${api}/projects/${project.id}/assignments/${first.id}`)
        .send({ toDate: addDays(today, 12) });
      expect([move.status, errorBody(move).params]).toEqual([409, { field: 'overlap' }]);
    });

    it('lets two simultaneous requests through only once', async () => {
      const project = await made(hr, { leadEmployeeId: hr.employeeId });
      const body = { employeeId: eve.employeeId, allocationPct: 30, ...range(40, 50) };
      const results = await Promise.all([
        staff(hr, project.id, body),
        staff(hr, project.id, body),
        staff(hr, project.id, body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(await system.projectAssignment.count({ where: { projectId: project.id } })).toBe(1);
    });

    it('flags people planned above 100 % across projects, and clears the flag when that ends', async () => {
      const solo = await onboard(acme, `solo${++counter}`);
      const other = await onboard(acme, `other${++counter}`);
      const a = await made(hr, { leadEmployeeId: hr.employeeId });
      const b = await made(hr, { leadEmployeeId: hr.employeeId });
      const first = await staffed(hr, a.id, {
        employeeId: solo.employeeId,
        allocationPct: 60,
        ...range(100, 130),
      });
      expect(first.overAllocated).toBe(false);
      const second = await staffed(hr, b.id, {
        employeeId: solo.employeeId,
        allocationPct: 60,
        ...range(120, 150),
      });
      expect(second.overAllocated).toBe(true);
      const detailA = projectDetailSchema.parse((await open(hr, a.id)).body);
      expect(detailA.assignments[0]?.overAllocated).toBe(true); // the other project's overlap counts here too
      const edgeOk = await staffed(hr, a.id, {
        employeeId: other.employeeId,
        allocationPct: 100,
        ...range(100, 130),
      });
      expect(edgeOk.overAllocated).toBe(false); // exactly 100 is fine
      // moving the second period away clears both flags
      const moved = await hr.agent
        .patch(`${api}/projects/${b.id}/assignments/${second.id}`)
        .send({ fromDate: addDays(today, 131) });
      expect(assignmentSchema.parse(moved.body).overAllocated).toBe(false);
      expect(
        projectDetailSchema
          .parse((await open(hr, a.id)).body)
          .assignments.every((x) => !x.overAllocated),
      ).toBe(true);
    });

    it('tells the person, except when they staff themselves, and carries only the project', async () => {
      const project = await made(mia, { name: 'Notified project' });
      await staffed(mia, project.id, {
        employeeId: dan.employeeId,
        allocationPct: 10,
        ...range(0, null),
      });
      await staffed(mia, project.id, {
        employeeId: mia.employeeId,
        allocationPct: 10,
        ...range(0, null),
      });
      const forDan = (await notesOf(dan)).filter((n) => n.type === 'project.assigned');
      expect(forDan.find((n) => n.params.projectId === project.id)?.params).toEqual({
        projectId: project.id,
        projectName: 'Notified project',
      });
      expect((await notesOf(mia)).filter((n) => n.type === 'project.assigned')).toEqual([]);
    });

    it('can be changed and removed, and refuses unknown ids and other projects', async () => {
      const project = await made(hr, { leadEmployeeId: hr.employeeId });
      const other = await made(hr, { leadEmployeeId: hr.employeeId });
      const a = await staffed(hr, project.id, {
        employeeId: gus.employeeId,
        allocationPct: 50,
        role: 'Dev',
        ...range(0, 10),
      });
      const changed = await hr.agent
        .patch(`${api}/projects/${project.id}/assignments/${a.id}`)
        .send({ allocationPct: 80, role: ' ', toDate: null });
      expect(assignmentSchema.parse(changed.body)).toMatchObject({
        allocationPct: 80,
        role: null,
        toDate: null,
      });
      for (const body of [
        {},
        { allocationPct: 0 },
        { fromDate: addDays(today, 5), toDate: addDays(today, 1) },
      ]) {
        const res = await hr.agent
          .patch(`${api}/projects/${project.id}/assignments/${a.id}`)
          .send(body);
        expect([res.status, errorBody(res).code], JSON.stringify(body)).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
      expect(
        (
          await hr.agent
            .patch(`${api}/projects/${other.id}/assignments/${a.id}`)
            .send({ allocationPct: 5 })
        ).status,
      ).toBe(404);
      expect(
        (await hr.agent.delete(`${api}/projects/${other.id}/assignments/${a.id}`)).status,
      ).toBe(404);
      expect(
        (await dan.agent.delete(`${api}/projects/${project.id}/assignments/${a.id}`)).status,
      ).toBe(403); // employees do not hold assignment.manage at all
      expect(
        (await hr.agent.delete(`${api}/projects/${project.id}/assignments/${a.id}`)).status,
      ).toBe(204);
      expect(
        (await hr.agent.delete(`${api}/projects/${project.id}/assignments/${a.id}`)).status,
      ).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('milestones and health', () => {
    it('are added, finished, reopened and removed by whoever manages the project', async () => {
      const project = await made(mia, { status: 'active' });
      const create = await mia.agent
        .post(`${api}/projects/${project.id}/milestones`)
        .send({ title: ' Beta ', dueDate: addDays(today, 10) });
      expect(create.status).toBe(201);
      const m = milestoneSchema.parse(create.body);
      expect(m).toMatchObject({ title: 'Beta', status: 'open', doneOn: null, overdueDays: 0 });
      const done = milestoneSchema.parse(
        (
          await mia.agent
            .patch(`${api}/projects/${project.id}/milestones/${m.id}`)
            .send({ status: 'done' })
        ).body,
      );
      expect(done).toMatchObject({ status: 'done', doneOn: today });
      const again = milestoneSchema.parse(
        (
          await mia.agent
            .patch(`${api}/projects/${project.id}/milestones/${m.id}`)
            .send({ status: 'done' })
        ).body,
      );
      expect(again.doneOn).toBe(today); // finishing twice keeps the date
      const reopened = milestoneSchema.parse(
        (
          await mia.agent
            .patch(`${api}/projects/${project.id}/milestones/${m.id}`)
            .send({ status: 'open', title: 'Beta 2' })
        ).body,
      );
      expect(reopened).toMatchObject({ status: 'open', doneOn: null, title: 'Beta 2' });
      expect(
        (await mia.agent.delete(`${api}/projects/${project.id}/milestones/${m.id}`)).status,
      ).toBe(204);
      expect(
        (await mia.agent.delete(`${api}/projects/${project.id}/milestones/${m.id}`)).status,
      ).toBe(404);
      expect(
        (
          await hr.agent
            .post(`${api}/projects/${project.id}/milestones`)
            .send({ title: 'By HR', dueDate: today })
        ).status,
      ).toBe(201);
    });

    it('refuse bad input, strangers and other projects', async () => {
      const project = await made(mia, {});
      const other = await made(hr, { leadEmployeeId: hr.employeeId });
      const path = `${api}/projects/${project.id}/milestones`;
      for (const body of [
        {},
        { title: ' ', dueDate: today },
        { title: 'x', dueDate: 'soon' },
        { title: 'x', dueDate: today, status: 'done' },
      ]) {
        const res = await mia.agent.post(path).send(body);
        expect([res.status, errorBody(res).code], JSON.stringify(body)).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
      const m = milestoneSchema.parse(
        (await mia.agent.post(path).send({ title: 'Real', dueDate: today })).body,
      );
      expect((await ron.agent.post(path).send({ title: 'x', dueDate: today })).status).toBe(404);
      expect(
        (
          await mia.agent
            .patch(`${api}/projects/${other.id}/milestones/${m.id}`)
            .send({ title: 'x' })
        ).status,
      ).toBe(404);
      expect((await mia.agent.patch(`${path}/${m.id}`).send({})).status).toBe(400);
      expect((await mia.agent.patch(`${path}/${UNKNOWN}`).send({ title: 'x' })).status).toBe(404);
      await staffed(hr, other.id, {
        employeeId: dan.employeeId,
        allocationPct: 10,
        ...range(0, null),
      });
      const seen = await mia.agent
        .post(`${api}/projects/${other.id}/milestones`)
        .send({ title: 'x', dueDate: today });
      expect([seen.status, errorBody(seen).code]).toEqual([403, 'FORBIDDEN']); // visible through dan, not hers
    });

    it('make an active project at risk, then off track, and a finished milestone no longer counts', async () => {
      const project = await made(hr, {
        status: 'active',
        startDate: addDays(today, -60),
        leadEmployeeId: hr.employeeId,
      });
      const add = async (daysAgo: number) =>
        milestoneSchema.parse(
          (
            await hr.agent
              .post(`${api}/projects/${project.id}/milestones`)
              .send({ title: `M${daysAgo}`, dueDate: addDays(today, -daysAgo) })
          ).body,
        );
      const health = async () =>
        projectDetailSchema.parse((await open(hr, project.id)).body).health;
      expect(await health()).toBe('on_track');
      const m3 = await add(3);
      expect(m3.overdueDays).toBe(3);
      expect(await health()).toBe('at_risk');
      const m9 = await add(9);
      expect(await health()).toBe('off_track');
      const list = projectListSchema.parse(
        (await hr.agent.get(`${api}/projects`).query({ q: project.code })).body,
      );
      expect(list.items[0]?.health).toBe('off_track');
      await hr.agent
        .patch(`${api}/projects/${project.id}/milestones/${m9.id}`)
        .send({ status: 'done' });
      expect(await health()).toBe('at_risk');
      await hr.agent
        .patch(`${api}/projects/${project.id}/milestones/${m3.id}`)
        .send({ status: 'done' });
      expect(await health()).toBe('on_track');
      await hr.agent.patch(`${api}/projects/${project.id}`).send({ endDate: addDays(today, -1) });
      expect(await health()).toBe('off_track'); // the end date passed
      await hr.agent.patch(`${api}/projects/${project.id}`).send({ status: 'paused' });
      expect(await health()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('leavers, privacy and audit', () => {
    it('ends the staffing of a deactivated employee and frees projects they led', async () => {
      const leaver = await onboard(acme, 'leaver');
      const running = await made(hr, { leadEmployeeId: leaver.employeeId, name: 'Led by leaver' });
      const past = await made(hr, { leadEmployeeId: hr.employeeId });
      const future = await made(hr, { leadEmployeeId: hr.employeeId });
      const futureToo = await made(hr, { leadEmployeeId: hr.employeeId });
      const open = await staffed(hr, running.id, {
        employeeId: leaver.employeeId,
        allocationPct: 50,
        ...range(-20, null),
      });
      const later = await staffed(hr, running.id, {
        employeeId: gus.employeeId,
        allocationPct: 50,
        ...range(-20, null),
      });
      const ended = await staffed(hr, past.id, {
        employeeId: leaver.employeeId,
        allocationPct: 50,
        ...range(-30, -10),
      });
      const planned = await staffed(hr, future.id, {
        employeeId: leaver.employeeId,
        allocationPct: 50,
        ...range(30, 60),
      });
      const ending = await staffed(hr, futureToo.id, {
        employeeId: leaver.employeeId,
        allocationPct: 20,
        ...range(-5, 90),
      });
      const res = await hr.agent
        .post(`${api}/employees/${leaver.employeeId}/deactivate`)
        .send({ terminationDate: today });
      expect(res.status).toBe(200);
      const row = (id: string) => system.projectAssignment.findUnique({ where: { id } });
      expect((await row(open.id))?.toDate?.toISOString().slice(0, 10)).toBe(today);
      expect((await row(ending.id))?.toDate?.toISOString().slice(0, 10)).toBe(today);
      expect((await row(ended.id))?.toDate?.toISOString().slice(0, 10)).toBe(addDays(today, -10)); // already over: untouched
      expect(await row(planned.id)).toBeNull(); // would have started later
      expect((await row(later.id))?.toDate).toBeNull(); // somebody else's staffing is untouched
      expect(projectDetailSchema.parse((await open_(hr, running.id)).body).lead).toBeNull();
    });
    const open_ = (who: Member, id: string) => who.agent.get(`${api}/projects/${id}`);

    it('appears in the data export of the person, with the role', async () => {
      const project = await made(hr, {
        name: 'Exported project',
        code: 'EXP-1',
        leadEmployeeId: eve.employeeId,
      });
      await staffed(hr, project.id, {
        employeeId: dan.employeeId,
        role: 'Tester',
        allocationPct: 25,
        ...range(0, 9),
      });
      const doc = personalDataExportSchema.parse(
        (await dan.agent.get(`${api}/privacy/export`)).body,
      );
      expect(doc.projects.assignments).toContainEqual({
        project: 'Exported project',
        code: 'EXP-1',
        role: 'Tester',
        allocationPct: 25,
        fromDate: today,
        toDate: addDays(today, 9),
      });
      const leads = personalDataExportSchema.parse(
        (await eve.agent.get(`${api}/privacy/export`)).body,
      );
      expect(leads.projects.led).toContain('Exported project');
    });

    it('audits changes with ids and field names, never the text', async () => {
      const secret = 'Confidential codename Phoenix';
      const project = await made(hr, {
        name: secret,
        description: secret,
        leadEmployeeId: hr.employeeId,
      });
      await hr.agent.patch(`${api}/projects/${project.id}`).send({ name: `${secret} v2` });
      await staffed(hr, project.id, {
        employeeId: gus.employeeId,
        role: secret,
        allocationPct: 5,
        ...range(0, null),
      });
      const logs = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, entityId: project.id },
      });
      expect(logs.map((l) => l.action).sort()).toEqual(['project.created', 'project.updated']);
      const all = await system.auditLog.findMany({
        where: {
          tenantId: acme.tenantId,
          entity: { in: ['project', 'project_assignment', 'client', 'milestone'] },
        },
      });
      expect(JSON.stringify(all)).not.toContain('Phoenix');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('tenant isolation and database rules', () => {
    it('keeps another workspace away from clients, projects and staffing', async () => {
      const client = clientSchema.parse((await createClient(hr, { name: 'Private client' })).body);
      const project = await made(hr, { clientId: client.id, leadEmployeeId: hr.employeeId });
      const a = await staffed(hr, project.id, {
        employeeId: dan.employeeId,
        allocationPct: 10,
        ...range(0, null),
      });
      const g = globex.admin;
      expect(await listIds(g)).not.toContain(project.id);
      expect(clientListSchema.parse((await g.agent.get(`${api}/clients`)).body).items).toEqual([]);
      for (const res of [
        await open(g, project.id),
        await g.agent.patch(`${api}/projects/${project.id}`).send({ name: 'x' }),
        await staff(g, project.id, {
          employeeId: dan.employeeId,
          allocationPct: 10,
          ...range(0, null),
        }),
        await g.agent.delete(`${api}/projects/${project.id}/assignments/${a.id}`),
        await g.agent
          .post(`${api}/projects/${project.id}/milestones`)
          .send({ title: 'x', dueDate: today }),
        await g.agent.patch(`${api}/clients/${client.id}`).send({ notes: 'x' }),
      ]) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.project.findUnique({ where: { id: project.id } }),
        ),
      ).toBeNull();
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.project.deleteMany({ where: { id: project.id } }),
        ),
      ).toEqual({ count: 0 });
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.projectAssignment.updateMany({ where: { id: a.id }, data: { allocationPct: 1 } }),
        ),
      ).toEqual({ count: 0 });
      // a global project code can exist in both workspaces
      const g2 = await g.agent
        .post(`${api}/projects`)
        .send({ code: project.code, name: 'Same code', startDate: today });
      expect(g2.status).toBe(201);
      const foreign = await system.employee.findFirstOrThrow({
        where: { tenantId: globex.tenantId },
      });
      await expect(
        system.projectAssignment.create({
          data: {
            tenantId: acme.tenantId,
            projectId: project.id,
            employeeId: foreign.id,
            allocationPct: 10,
            fromDate: new Date(),
          },
        }),
      ).rejects.toThrow(); // an employee of another workspace
      await expect(
        asTenant(globex.tenantId, (tx) =>
          tx.client.create({ data: { tenantId: acme.tenantId, name: 'Smuggled' } }),
        ),
      ).rejects.toThrow();
    });

    it('enforces the rules in the database when the application is bypassed', async () => {
      const project = await made(hr, {});
      const base = {
        tenantId: acme.tenantId,
        projectId: project.id,
        employeeId: gus.employeeId,
        allocationPct: 10,
        fromDate: new Date(`${addDays(today, 300)}T00:00:00Z`),
      };
      const refuse = (promise: Promise<unknown>) => expect(promise).rejects.toThrow();
      await refuse(system.projectAssignment.create({ data: { ...base, allocationPct: 0 } }));
      await refuse(system.projectAssignment.create({ data: { ...base, allocationPct: 101 } }));
      await refuse(
        system.projectAssignment.create({
          data: { ...base, toDate: new Date(`${addDays(today, 299)}T00:00:00Z`) },
        }),
      );
      await refuse(system.projectAssignment.create({ data: { ...base, role: 'x'.repeat(61) } }));
      await system.projectAssignment.create({ data: base });
      await refuse(
        system.projectAssignment.create({
          data: { ...base, fromDate: new Date(`${addDays(today, 305)}T00:00:00Z`) },
        }),
      ); // overlaps the open one
      const p = { tenantId: acme.tenantId, name: 'Rules', startDate: new Date() };
      await refuse(system.project.create({ data: { ...p, code: 'bad code' } }));
      await refuse(system.project.create({ data: { ...p, code: 'OK-1', status: 'cancelled' } }));
      await refuse(system.project.create({ data: { ...p, code: 'OK-2', priority: 'urgent' } }));
      await refuse(system.project.create({ data: { ...p, code: 'OK-3', budgetHours: -1 } }));
      await refuse(
        system.project.create({
          data: { ...p, code: 'OK-4', endDate: new Date(Date.now() - 10 * 86_400_000) },
        }),
      );
      await refuse(system.project.create({ data: { ...p, code: project.code } })); // duplicate code
      await refuse(system.client.create({ data: { tenantId: acme.tenantId, name: 'INITECH' } })); // duplicate name, other case
      await refuse(
        system.client.create({ data: { tenantId: acme.tenantId, name: 'x', status: 'gone' } }),
      );
      const m = { tenantId: acme.tenantId, projectId: project.id, title: 'M', dueDate: new Date() };
      await refuse(system.milestone.create({ data: { ...m, status: 'done' } })); // done without a date
      await refuse(system.milestone.create({ data: { ...m, doneOn: new Date() } })); // a date without done
      await refuse(system.milestone.create({ data: { ...m, title: '' } }));
    });
  });
});
