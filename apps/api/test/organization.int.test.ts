import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  employeeListSchema,
  employeeSchema,
  orgChartSchema,
  type Relation,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORG_RELATIONS, type OrgRelations } from '../src/common/auth/authorization.service.js';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { TenantContext, type TenantTx } from '../src/infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../src/infrastructure/tenancy/tenant-db.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;
const UNKNOWN = '0192f5a0-0000-7000-8000-00000000000a';

describe.skipIf(!urls)('organization over HTTP (real database)', () => {
  const env = testEnv({
    DATABASE_URL: urls?.app,
    SYSTEM_DATABASE_URL: urls?.system,
    TRUST_PROXY: 'true',
  });
  let app: NestExpressApplication;
  let system: SystemPrismaService;
  const { workspace, member, accept } = httpWorkspaceHelpers(() => app);

  let acme: Workspace;
  let globex: Workspace;
  let hr: Member;
  type Person = Member & { employeeId: string };
  let mia: Person; // manager role
  let dan: Person; // reports to mia
  let eve: Person; // reports to dan (so: subordinate of mia)
  let fay: Person; // reports to mia
  let gus: Person; // no manager, same department as mia
  let adminEmployeeId: string;
  let eng: string;
  let ops: string;

  const asTenant = <T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>) =>
    app.get(TenantContext).run(tenantId, () => app.get(TenantDb).tx(fn));
  const relations = (ws: Workspace, actorUserId: string, ids: string[]) =>
    asTenant(ws.tenantId, () =>
      app.get<OrgRelations>(ORG_RELATIONS).relationsToEmployees(actorUserId, ids),
    );

  async function onboard(ws: Workspace, by: Member, name: string): Promise<Person> {
    const email = `${name}@${ws === acme ? 'acme' : 'globex'}.eu`;
    const res = await by.agent
      .post('/api/v1/employees')
      .send({ firstName: name, lastName: 'Test', employmentType: 'full_time', email });
    expect(res.status).toBe(201);
    const who = await accept(email);
    return { ...who, employeeId: employeeSchema.parse(res.body).id };
  }
  const assign = (
    who: Member,
    employeeId: string,
    managerId: string | null,
    departmentId: string | null,
  ) =>
    who.agent
      .put(`/api/v1/org/employees/${employeeId}/assignment`)
      .send({ managerId, departmentId });
  const profileOf = async (viewer: Member, employeeId: string) =>
    employeeSchema.parse((await viewer.agent.get(`/api/v1/employees/${employeeId}`)).body).profile;
  const managerRow = (id: string) => system.employee.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    hr = await member(acme, 'hr@acme.eu', 'hr');
    mia = await onboard(acme, hr, 'mia');
    dan = await onboard(acme, hr, 'dan');
    eve = await onboard(acme, hr, 'eve');
    fay = await onboard(acme, hr, 'fay');
    gus = await onboard(acme, hr, 'gus');
    const promote = await acme.admin.agent
      .put(`/api/v1/users/${mia.id}/roles`)
      .send({ roleIds: [acme.roleIds.manager] });
    expect(promote.status).toBe(200);
    adminEmployeeId = employeeSchema.parse(
      (await acme.admin.agent.get('/api/v1/employees/me')).body,
    ).id;

    eng = (await hr.agent.post('/api/v1/org/departments').send({ name: 'Engineering' })).body.id;
    ops = (await hr.agent.post('/api/v1/org/departments').send({ name: 'Operations' })).body.id;
    for (const [who, manager, dept] of [
      [mia, adminEmployeeId, eng],
      [dan, mia.employeeId, eng],
      [eve, dan.employeeId, ops],
      [fay, mia.employeeId, ops],
      [gus, null, eng],
    ] as const) {
      expect((await assign(hr, who.employeeId, manager, dept)).status).toBe(204);
    }
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  describe('relations behind the scopes', () => {
    it('tells self, direct report, subordinate, same department and other apart', async () => {
      const map = await relations(acme, mia.id, [
        mia.employeeId,
        dan.employeeId,
        eve.employeeId,
        fay.employeeId,
        gus.employeeId,
        adminEmployeeId,
      ]);
      const got = Object.fromEntries(
        [
          ['mia', mia],
          ['dan', dan],
          ['eve', eve],
          ['fay', fay],
          ['gus', gus],
        ].map(([name, p]) => [name as string, map.get((p as Person).employeeId)]),
      );
      expect(got).toEqual({
        mia: 'self',
        dan: 'direct_report',
        eve: 'subordinate',
        fay: 'direct_report',
        gus: 'same_department',
      } satisfies Record<string, Relation>);
      expect(map.get(adminEmployeeId)).toBe('other');
    });

    it('answers "other" for unknown ids, other workspaces and actors without an employee record', async () => {
      const foreign = await system.employee.findFirstOrThrow({
        where: { tenantId: globex.tenantId },
      });
      const map = await relations(acme, mia.id, [UNKNOWN, foreign.id]);
      expect(map.get(UNKNOWN) ?? 'other').toBe('other');
      expect(map.get(foreign.id) ?? 'other').toBe('other');

      const lone = await member(acme, 'lone@acme.eu', 'employee'); // account without employee record
      const loneMap = await relations(acme, lone.id, [dan.employeeId, mia.employeeId]);
      expect([...loneMap.values()].every((r) => r === 'other') || loneMap.size === 0).toBe(true);
    });

    it('does not count an empty department as shared and lets a closer relation win', async () => {
      const a = await onboard(acme, hr, 'nodeptx');
      const b = await onboard(acme, hr, 'nodepty');
      expect((await relations(acme, a.id, [b.employeeId])).get(b.employeeId)).toBe('other');
      // gus shares a department with dan but dan is a subordinate of mia: for mia, dan stays direct_report.
      expect((await relations(acme, mia.id, [dan.employeeId])).get(dan.employeeId)).toBe(
        'direct_report',
      );
    });

    it('follows a long chain of command', async () => {
      const chain: Person[] = [];
      let boss: Person | null = null;
      for (let i = 0; i < 6; i++) {
        const p = await onboard(acme, hr, `chain${i}`);
        if (boss) expect((await assign(hr, p.employeeId, boss.employeeId, null)).status).toBe(204);
        chain.push(p);
        boss = p;
      }
      const top = chain[0]!;
      const bottom = chain[5]!;
      expect((await relations(acme, top.id, [bottom.employeeId])).get(bottom.employeeId)).toBe(
        'subordinate',
      );
      expect((await relations(acme, bottom.id, [top.employeeId])).get(top.employeeId)).toBe(
        'other',
      );
    });
  });

  describe('what managers see because of the tree', () => {
    it('shows a manager the profiles of reports and everybody below them, nobody else', async () => {
      for (const p of [dan, fay, eve]) expect(await profileOf(mia, p.employeeId)).not.toBeNull();
      expect(await profileOf(mia, gus.employeeId)).toBeNull(); // same department, but scope "team"
      expect(await profileOf(mia, adminEmployeeId)).toBeNull(); // above her
      expect(await profileOf(dan, eve.employeeId)).toBeNull(); // plain employee: own only
      expect(await profileOf(dan, dan.employeeId)).not.toBeNull();
    });

    it('follows changes immediately, in both directions', async () => {
      expect((await assign(hr, gus.employeeId, mia.employeeId, eng)).status).toBe(204);
      expect(await profileOf(mia, gus.employeeId)).not.toBeNull();
      // dan (and so eve) leave mia's branch
      expect((await assign(hr, dan.employeeId, gus.employeeId, eng)).status).toBe(204);
      expect(await profileOf(mia, eve.employeeId)).not.toBeNull(); // still below: mia -> gus -> dan -> eve
      expect((await assign(hr, gus.employeeId, null, eng)).status).toBe(204);
      expect(await profileOf(mia, dan.employeeId)).toBeNull();
      expect(await profileOf(mia, eve.employeeId)).toBeNull();
      // restore
      expect((await assign(hr, dan.employeeId, mia.employeeId, eng)).status).toBe(204);
    });

    it('lets a manager see the profile of a report who has no account', async () => {
      const created = await hr.agent.post('/api/v1/employees').send({
        firstName: 'Ghost',
        lastName: 'Report',
        employmentType: 'contractor',
        phone: '+49 30 1234567',
      });
      const ghost = employeeSchema.parse(created.body).id;
      expect(await profileOf(mia, ghost)).toBeNull();
      expect((await assign(hr, ghost, mia.employeeId, null)).status).toBe(204);
      expect((await profileOf(mia, ghost))?.phone).toBe('+49 30 1234567');
      expect(await profileOf(fay, ghost)).toBeNull();
    });

    it('filters a whole list with the same rules', async () => {
      const list = employeeListSchema.parse(
        (await mia.agent.get('/api/v1/employees?pageSize=100')).body,
      );
      const visible = new Set(list.items.filter((e) => e.profile).map((e) => e.id));
      expect(visible).toContain(dan.employeeId);
      expect(visible).toContain(eve.employeeId);
      expect(visible).toContain(mia.employeeId);
      expect(visible).not.toContain(gus.employeeId);
      expect(visible).not.toContain(adminEmployeeId);
    });

    it('shows department, manager and teams and filters the directory by department', async () => {
      const own = employeeSchema.parse((await dan.agent.get('/api/v1/employees/me')).body);
      expect(own.department).toMatchObject({ id: eng, name: 'Engineering' });
      expect(own.manager).toMatchObject({ id: mia.employeeId, firstName: 'mia' });
      expect(own.teams).toEqual([]);
      const filtered = employeeListSchema.parse(
        (await dan.agent.get(`/api/v1/employees?departmentId=${ops}&pageSize=100`)).body,
      );
      expect(filtered.items.map((e) => e.id).sort()).toEqual(
        [eve.employeeId, fay.employeeId].sort(),
      );
      expect((await dan.agent.get('/api/v1/employees?departmentId=nope')).status).toBe(400);
    });
  });

  describe('assigning manager and department', () => {
    it.each([
      ['an employee', () => dan],
      ['a manager', () => mia],
    ])('is forbidden for %s', async (_label, who) => {
      const res = await assign(who(), eve.employeeId, null, null);
      expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
    });

    it('is refused when it would create a cycle', async () => {
      const self = await assign(hr, mia.employeeId, mia.employeeId, null);
      expect([self.status, errorBody(self).code]).toEqual([409, 'ORG_CYCLE']);
      // mia -> dan -> eve: mia under eve (or dan) would loop
      for (const manager of [eve.employeeId, dan.employeeId]) {
        const res = await assign(hr, mia.employeeId, manager, eng);
        expect([res.status, errorBody(res).code]).toEqual([409, 'ORG_CYCLE']);
      }
      const top = await assign(hr, adminEmployeeId, eve.employeeId, null);
      expect([top.status, errorBody(top).code]).toEqual([409, 'ORG_CYCLE']);
      expect((await managerRow(mia.employeeId)).managerId).toBe(adminEmployeeId);
    });

    it('lets only one of two opposite concurrent moves win, for many pairs at once', async () => {
      const pairs: [Person, Person][] = [];
      for (let i = 0; i < 8; i++) {
        pairs.push([await onboard(acme, hr, `racea${i}x`), await onboard(acme, hr, `raceb${i}y`)]);
      }
      const results = await Promise.all(
        pairs.flatMap(([a, b]) => [
          assign(hr, a.employeeId, b.employeeId, null),
          assign(hr, b.employeeId, a.employeeId, null),
        ]),
      );
      expect(results.map((r) => r.status).sort()).toEqual([
        ...Array(8).fill(204),
        ...Array(8).fill(409),
      ]);
      for (const [a, b] of pairs) {
        const rows = await system.employee.findMany({
          where: { id: { in: [a.employeeId, b.employeeId] } },
        });
        expect(rows.filter((r) => r.managerId !== null)).toHaveLength(1);
      }
    });

    it.each([
      ['an unknown manager', () => ({ managerId: UNKNOWN, departmentId: null })],
      ['an unknown department', () => ({ managerId: null, departmentId: UNKNOWN })],
    ])('rejects %s', async (_label, body) => {
      const res = await hr.agent
        .put(`/api/v1/org/employees/${gus.employeeId}/assignment`)
        .send(body());
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('rejects malformed bodies and unknown or inactive employees', async () => {
      const path = `/api/v1/org/employees/${gus.employeeId}/assignment`;
      for (const body of [
        {},
        { managerId: null },
        { managerId: 'x', departmentId: null },
        { managerId: null, departmentId: null, status: 'x' },
      ]) {
        expect((await hr.agent.put(path).send(body)).status).toBe(400);
      }
      expect((await assign(hr, UNKNOWN, null, null)).status).toBe(404);
      const gone = await onboard(acme, hr, 'gone');
      await hr.agent.post(`/api/v1/employees/${gone.employeeId}/deactivate`).send({});
      const res = await assign(hr, gone.employeeId, null, null);
      expect([res.status, errorBody(res).params]).toEqual([409, { field: 'status' }]);
      const asManager = await assign(hr, gus.employeeId, gone.employeeId, null);
      expect([asManager.status, errorBody(asManager).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('audits ids only and writes nothing for a change that changes nothing', async () => {
      const target = await onboard(acme, hr, 'audited');
      await assign(hr, target.employeeId, mia.employeeId, eng);
      const count = () =>
        system.auditLog.count({
          where: { entityId: target.employeeId, action: 'org.employee_assigned' },
        });
      expect(await count()).toBe(1);
      await assign(hr, target.employeeId, mia.employeeId, eng);
      expect(await count()).toBe(1);
      const entry = await system.auditLog.findFirstOrThrow({
        where: { entityId: target.employeeId, action: 'org.employee_assigned' },
      });
      expect(entry.after).toEqual({ managerId: mia.employeeId, departmentId: eng });
    });
  });

  describe('departments', () => {
    it('lets everybody read the structure and only HR/Admin change it', async () => {
      for (const path of ['/org/chart', '/org/departments', '/org/teams']) {
        expect((await dan.agent.get(`/api/v1${path}`)).status).toBe(200);
      }
      const forbidden = await dan.agent.post('/api/v1/org/departments').send({ name: 'Nope' });
      expect([forbidden.status, errorBody(forbidden).code]).toEqual([403, 'FORBIDDEN']);
      expect((await mia.agent.post('/api/v1/org/departments').send({ name: 'Nope' })).status).toBe(
        403,
      );
      expect((await mia.agent.delete(`/api/v1/org/departments/${ops}`)).status).toBe(403);
      expect(
        (await acme.admin.agent.post('/api/v1/org/departments').send({ name: 'Admin made' }))
          .status,
      ).toBe(201);
    });

    it('lists departments with head and counts', async () => {
      expect(
        (
          await hr.agent
            .patch(`/api/v1/org/departments/${eng}`)
            .send({ headEmployeeId: mia.employeeId })
        ).status,
      ).toBe(200);
      const list = (await dan.agent.get('/api/v1/org/departments')).body as {
        id: string;
        head: { id: string } | null;
        employeeCount: number;
        teamCount: number;
      }[];
      const engRow = list.find((d) => d.id === eng);
      expect(engRow?.head?.id).toBe(mia.employeeId);
      expect(engRow?.employeeCount).toBeGreaterThanOrEqual(3);
    });

    it('refuses duplicate names ignoring case, within one workspace only', async () => {
      const dup = await hr.agent.post('/api/v1/org/departments').send({ name: ' engineering ' });
      expect([dup.status, errorBody(dup).params]).toEqual([409, { field: 'name' }]);
      expect(
        (await globex.admin.agent.post('/api/v1/org/departments').send({ name: 'Engineering' }))
          .status,
      ).toBe(201);
      const rename = await hr.agent
        .patch(`/api/v1/org/departments/${ops}`)
        .send({ name: 'ENGINEERING' });
      expect([rename.status, errorBody(rename).params]).toEqual([409, { field: 'name' }]);
      expect(
        (await hr.agent.patch(`/api/v1/org/departments/${ops}`).send({ name: 'OPERATIONS' }))
          .status,
      ).toBe(200);
    });

    it.each([
      ['a blank name', { name: '  ' }],
      ['an unknown field', { name: 'X', tenantId: UNKNOWN }],
      ['a non-uuid parent', { name: 'X', parentId: 'root' }],
    ])('rejects %s', async (_label, body) => {
      expect((await hr.agent.post('/api/v1/org/departments').send(body)).status).toBe(400);
    });

    it('rejects an unknown parent or a head who is not an active employee', async () => {
      expect(
        (await hr.agent.post('/api/v1/org/departments').send({ name: 'X1', parentId: UNKNOWN }))
          .status,
      ).toBe(400);
      expect(
        (
          await hr.agent
            .post('/api/v1/org/departments')
            .send({ name: 'X2', headEmployeeId: UNKNOWN })
        ).status,
      ).toBe(400);
      const foreign = await system.employee.findFirstOrThrow({
        where: { tenantId: globex.tenantId },
      });
      expect(
        (
          await hr.agent
            .post('/api/v1/org/departments')
            .send({ name: 'X3', headEmployeeId: foreign.id })
        ).status,
      ).toBe(400);
    });

    it('keeps the tree free of cycles', async () => {
      const a = (await hr.agent.post('/api/v1/org/departments').send({ name: 'Tree A' })).body
        .id as string;
      const b = (
        await hr.agent.post('/api/v1/org/departments').send({ name: 'Tree B', parentId: a })
      ).body.id as string;
      const c = (
        await hr.agent.post('/api/v1/org/departments').send({ name: 'Tree C', parentId: b })
      ).body.id as string;
      for (const [id, parent] of [
        [a, a],
        [a, b],
        [a, c],
        [b, c],
      ] as const) {
        const res = await hr.agent
          .patch(`/api/v1/org/departments/${id}`)
          .send({ parentId: parent });
        expect([res.status, errorBody(res).code]).toEqual([409, 'ORG_CYCLE']);
      }
      expect(
        (await hr.agent.patch(`/api/v1/org/departments/${c}`).send({ parentId: a })).status,
      ).toBe(200);
      expect(
        (await hr.agent.patch(`/api/v1/org/departments/${c}`).send({ parentId: null })).status,
      ).toBe(200);
    });

    it('deletes only empty departments', async () => {
      const parent = (await hr.agent.post('/api/v1/org/departments').send({ name: 'Del parent' }))
        .body.id as string;
      const child = (
        await hr.agent.post('/api/v1/org/departments').send({ name: 'Del child', parentId: parent })
      ).body.id as string;
      const blocked = await hr.agent.delete(`/api/v1/org/departments/${parent}`);
      expect([blocked.status, errorBody(blocked).params]).toEqual([409, { field: 'in_use' }]);
      const team = (
        await hr.agent.post('/api/v1/org/teams').send({ name: 'T', departmentId: child })
      ).body.id as string;
      expect((await hr.agent.delete(`/api/v1/org/departments/${child}`)).status).toBe(409);
      expect((await hr.agent.delete(`/api/v1/org/teams/${team}`)).status).toBe(204);
      expect((await hr.agent.delete(`/api/v1/org/departments/${child}`)).status).toBe(204);
      expect((await hr.agent.delete(`/api/v1/org/departments/${parent}`)).status).toBe(204);
      expect((await hr.agent.delete(`/api/v1/org/departments/${parent}`)).status).toBe(404);
      // a department with employees cannot go either
      expect((await hr.agent.delete(`/api/v1/org/departments/${eng}`)).status).toBe(409);
    });
  });

  describe('teams', () => {
    let team: string;

    it('creates teams, allows the same name in another department but not in the same one', async () => {
      const created = await hr.agent
        .post('/api/v1/org/teams')
        .send({ name: 'Backend', departmentId: eng, leadEmployeeId: dan.employeeId });
      expect(created.status).toBe(201);
      team = created.body.id;
      expect(created.body).toMatchObject({
        name: 'Backend',
        department: { id: eng },
        lead: { id: dan.employeeId },
        members: [],
      });
      expect(
        (await hr.agent.post('/api/v1/org/teams').send({ name: 'Backend', departmentId: ops }))
          .status,
      ).toBe(201);
      const dup = await hr.agent
        .post('/api/v1/org/teams')
        .send({ name: 'BACKEND', departmentId: eng });
      expect([dup.status, errorBody(dup).params]).toEqual([409, { field: 'name' }]);
      expect(
        (await hr.agent.post('/api/v1/org/teams').send({ name: 'X', departmentId: UNKNOWN }))
          .status,
      ).toBe(400);
      expect((await hr.agent.post('/api/v1/org/teams').send({ name: 'X' })).status).toBe(400);
      expect(
        (await dan.agent.post('/api/v1/org/teams').send({ name: 'X', departmentId: eng })).status,
      ).toBe(403);
    });

    it('replaces the members and reports what changed', async () => {
      const set = (ids: string[]) =>
        hr.agent.put(`/api/v1/org/teams/${team}/members`).send({ employeeIds: ids });
      const first = await set([dan.employeeId, eve.employeeId]);
      expect(first.status).toBe(200);
      expect(first.body.members.map((m: { id: string }) => m.id).sort()).toEqual(
        [dan.employeeId, eve.employeeId].sort(),
      );
      const second = await set([eve.employeeId, fay.employeeId]);
      expect(second.body.members.map((m: { id: string }) => m.id).sort()).toEqual(
        [eve.employeeId, fay.employeeId].sort(),
      );
      const log = await system.auditLog.findFirstOrThrow({
        where: { entityId: team, action: 'org.team_members_changed' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log.after).toEqual({ added: [fay.employeeId], removed: [dan.employeeId] });
      expect((await set([])).body.members).toEqual([]);
      await set([dan.employeeId]);
      const dansTeams = employeeSchema.parse(
        (await dan.agent.get('/api/v1/employees/me')).body,
      ).teams;
      expect(dansTeams).toEqual([{ id: team, name: 'Backend' }]);
    });

    it.each([
      ['duplicates', (ids: Record<string, string>) => [ids.dan, ids.dan]],
      ['an unknown employee', () => [UNKNOWN]],
      ['a non-uuid', () => ['dan']],
    ])('rejects %s as members', async (_label, make) => {
      const res = await hr.agent
        .put(`/api/v1/org/teams/${team}/members`)
        .send({ employeeIds: make({ dan: dan.employeeId }) });
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('rejects members of other workspaces and members who are not employees of this one', async () => {
      const foreign = await system.employee.findFirstOrThrow({
        where: { tenantId: globex.tenantId },
      });
      const res = await hr.agent
        .put(`/api/v1/org/teams/${team}/members`)
        .send({ employeeIds: [foreign.id] });
      expect(res.status).toBe(400);
      expect(
        (await hr.agent.put(`/api/v1/org/teams/${UNKNOWN}/members`).send({ employeeIds: [] }))
          .status,
      ).toBe(404);
      expect(
        (await dan.agent.put(`/api/v1/org/teams/${team}/members`).send({ employeeIds: [] })).status,
      ).toBe(403);
    });

    it('renames, moves and clears the lead; deleting a team removes its memberships', async () => {
      expect(
        (await hr.agent.patch(`/api/v1/org/teams/${team}`).send({ name: 'Platform' })).body.name,
      ).toBe('Platform');
      expect(
        (await hr.agent.patch(`/api/v1/org/teams/${team}`).send({ leadEmployeeId: null })).body
          .lead,
      ).toBeNull();
      expect((await hr.agent.patch(`/api/v1/org/teams/${team}`).send({})).status).toBe(400);
      const moved = await hr.agent.patch(`/api/v1/org/teams/${team}`).send({ departmentId: ops });
      expect([moved.status, moved.body.department.id]).toEqual([200, ops]);
      // moving into a department that already has a team of that name is a conflict
      await hr.agent.post('/api/v1/org/teams').send({ name: 'Platform', departmentId: eng });
      const clash = await hr.agent.patch(`/api/v1/org/teams/${team}`).send({ departmentId: eng });
      expect([clash.status, errorBody(clash).params]).toEqual([409, { field: 'name' }]);
      expect((await hr.agent.delete(`/api/v1/org/teams/${team}`)).status).toBe(204);
      expect(await system.teamMember.count({ where: { teamId: team } })).toBe(0);
    });
  });

  describe('when somebody leaves and comes back', () => {
    it('keeps the tree whole and restores sensible state', async () => {
      // dan: manager of eve, lead of a team, head of a department, member of a team
      const dept = (
        await hr.agent
          .post('/api/v1/org/departments')
          .send({ name: 'Leaver dept', headEmployeeId: dan.employeeId })
      ).body.id as string;
      const led = (
        await hr.agent
          .post('/api/v1/org/teams')
          .send({ name: 'Led team', departmentId: eng, leadEmployeeId: dan.employeeId })
      ).body.id as string;
      const joined = (
        await hr.agent.post('/api/v1/org/teams').send({ name: 'Joined team', departmentId: eng })
      ).body.id as string;
      await hr.agent
        .put(`/api/v1/org/teams/${joined}/members`)
        .send({ employeeIds: [dan.employeeId, fay.employeeId] });

      const res = await hr.agent.post(`/api/v1/employees/${dan.employeeId}/deactivate`).send({});
      expect(res.status).toBe(200);

      expect((await managerRow(eve.employeeId)).managerId).toBe(mia.employeeId);
      expect(
        (await system.department.findUniqueOrThrow({ where: { id: dept } })).headEmployeeId,
      ).toBeNull();
      expect(
        (await system.team.findUniqueOrThrow({ where: { id: led } })).leadEmployeeId,
      ).toBeNull();
      expect(
        (await system.teamMember.findMany({ where: { teamId: joined } })).map((m) => m.employeeId),
      ).toEqual([fay.employeeId]);
      expect(await profileOf(mia, eve.employeeId)).not.toBeNull();

      const chart = orgChartSchema.parse((await hr.agent.get('/api/v1/org/chart')).body);
      expect(chart.nodes.some((n) => n.id === dan.employeeId)).toBe(false);
      expect(chart.nodes.find((n) => n.id === eve.employeeId)?.managerId).toBe(mia.employeeId);

      const log = await system.auditLog.findFirstOrThrow({
        where: { entityId: dan.employeeId, action: 'org.employee_offboarded' },
      });
      expect(log.after).toMatchObject({
        reportIds: [eve.employeeId],
        newManagerId: mia.employeeId,
        teamsLeft: 1,
      });

      // back: manager still active -> kept; department kept
      expect((await hr.agent.post(`/api/v1/employees/${dan.employeeId}/reactivate`)).status).toBe(
        200,
      );
      expect((await managerRow(dan.employeeId)).managerId).toBe(mia.employeeId);
      expect((await managerRow(dan.employeeId)).departmentId).toBe(eng);
    });

    it('drops a returning employee’s manager when that manager has left meanwhile', async () => {
      const boss = await onboard(acme, hr, 'boss');
      const sub = await onboard(acme, hr, 'sub');
      await assign(hr, sub.employeeId, boss.employeeId, null);
      await hr.agent.post(`/api/v1/employees/${sub.employeeId}/deactivate`).send({});
      await hr.agent.post(`/api/v1/employees/${boss.employeeId}/deactivate`).send({});
      expect((await hr.agent.post(`/api/v1/employees/${sub.employeeId}/reactivate`)).status).toBe(
        200,
      );
      expect((await managerRow(sub.employeeId)).managerId).toBeNull();
    });

    it('moves reports up to the leaver’s own manager, or to nobody', async () => {
      const top = await onboard(acme, hr, 'top');
      const mid = await onboard(acme, hr, 'mid');
      const low = await onboard(acme, hr, 'low');
      await assign(hr, mid.employeeId, top.employeeId, null);
      await assign(hr, low.employeeId, mid.employeeId, null);
      await hr.agent.post(`/api/v1/employees/${mid.employeeId}/deactivate`).send({});
      expect((await managerRow(low.employeeId)).managerId).toBe(top.employeeId);
      await hr.agent.post(`/api/v1/employees/${top.employeeId}/deactivate`).send({});
      expect((await managerRow(low.employeeId)).managerId).toBeNull();
    });
  });

  describe('chart', () => {
    it('lists active employees of this workspace only', async () => {
      const chart = orgChartSchema.parse((await fay.agent.get('/api/v1/org/chart')).body);
      const ids = new Set(chart.nodes.map((n) => n.id));
      expect(ids.has(mia.employeeId)).toBe(true);
      const foreign = await system.employee.findMany({ where: { tenantId: globex.tenantId } });
      expect(foreign.length).toBeGreaterThan(0);
      for (const f of foreign) expect(ids.has(f.id)).toBe(false);
      expect(JSON.stringify(chart)).not.toMatch(/birth|phone|email/i);
    });

    it('requires sign-in', async () => {
      const { agent } = httpWorkspaceHelpers(() => app);
      expect((await agent().get('/api/v1/org/chart')).status).toBe(401);
    });
  });

  describe('tenant isolation', () => {
    it('hides acme structure from globex for reads and every write', async () => {
      const foreignTeam = (
        await hr.agent.post('/api/v1/org/teams').send({ name: 'Acme only', departmentId: eng })
      ).body.id as string;
      const g = globex.admin;
      const teams = (await g.agent.get('/api/v1/org/teams')).body as { id: string }[];
      const depts = (await g.agent.get('/api/v1/org/departments')).body as { id: string }[];
      expect(teams.some((t) => t.id === foreignTeam)).toBe(false);
      expect(depts.some((d) => d.id === eng)).toBe(false);
      const attempts = [
        g.agent.patch(`/api/v1/org/departments/${eng}`).send({ name: 'Hacked' }),
        g.agent.delete(`/api/v1/org/departments/${eng}`),
        g.agent.patch(`/api/v1/org/teams/${foreignTeam}`).send({ name: 'Hacked' }),
        g.agent.delete(`/api/v1/org/teams/${foreignTeam}`),
        g.agent.put(`/api/v1/org/teams/${foreignTeam}/members`).send({ employeeIds: [] }),
        assign(g, mia.employeeId, null, null),
      ];
      for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
      const own = (await g.agent.get('/api/v1/employees/me')).body.id as string;
      const crossManager = await assign(g, own, mia.employeeId, null);
      expect(crossManager.status).toBe(400);
      const crossDept = await assign(g, own, null, eng);
      expect(crossDept.status).toBe(400);
      expect((await system.department.findUniqueOrThrow({ where: { id: eng } })).name).toBe(
        'Engineering',
      );
    });

    it('is enforced by the database itself', async () => {
      const foreign = await system.employee.findFirstOrThrow({
        where: { tenantId: globex.tenantId },
      });
      expect(
        await asTenant(globex.tenantId, (tx) => tx.department.findUnique({ where: { id: eng } })),
      ).toBeNull();
      expect(
        await asTenant(globex.tenantId, (tx) => tx.department.deleteMany({ where: { id: eng } })),
      ).toEqual({ count: 0 });
      await expect(
        asTenant(globex.tenantId, (tx) =>
          tx.department.create({ data: { tenantId: acme.tenantId, name: 'Sneaky' } }),
        ),
      ).rejects.toThrow();
      // composite foreign keys: no pointing at another workspace's rows
      await expect(
        system.employee.update({ where: { id: mia.employeeId }, data: { managerId: foreign.id } }),
      ).rejects.toThrow();
      await expect(
        system.team.create({
          data: {
            tenantId: acme.tenantId,
            name: 'Cross',
            departmentId: (
              await system.department.findFirstOrThrow({ where: { tenantId: globex.tenantId } })
            ).id,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('database safety nets', () => {
    it('refuses cycles and self-management even when the application is bypassed', async () => {
      await expect(
        system.employee.update({
          where: { id: mia.employeeId },
          data: { managerId: mia.employeeId },
        }),
      ).rejects.toThrow();
      await expect(
        system.employee.update({
          where: { id: mia.employeeId },
          data: { managerId: eve.employeeId },
        }),
      ).rejects.toThrow(/cycle/);
      const parent = await system.department.create({
        data: { tenantId: acme.tenantId, name: 'DB parent' },
      });
      const child = await system.department.create({
        data: { tenantId: acme.tenantId, name: 'DB child', parentId: parent.id },
      });
      await expect(
        system.department.update({ where: { id: parent.id }, data: { parentId: child.id } }),
      ).rejects.toThrow(/cycle/);
      await expect(
        system.department.update({ where: { id: parent.id }, data: { parentId: parent.id } }),
      ).rejects.toThrow();
    });

    it('refuses blank and case-duplicate names', async () => {
      await expect(
        system.department.create({ data: { tenantId: acme.tenantId, name: '  ' } }),
      ).rejects.toThrow();
      await expect(
        system.department.create({ data: { tenantId: acme.tenantId, name: 'engineering' } }),
      ).rejects.toThrow();
      await expect(
        system.team.create({ data: { tenantId: acme.tenantId, departmentId: eng, name: '' } }),
      ).rejects.toThrow();
    });
  });
});
