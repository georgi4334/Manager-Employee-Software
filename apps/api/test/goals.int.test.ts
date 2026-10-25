import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  employeeSchema,
  goalDetailSchema,
  goalListSchema,
  goalTeamsSchema,
  personalDataExportSchema,
  todayIn,
  type SystemRole,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { OutboxWorker } from '../src/modules/notifications/delivery/outbox-worker.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;
const UNKNOWN = '0192f5a0-0000-7000-8000-00000000000a';
const ZONE = 'Europe/Sofia';
const api = '/api/v1';

describe.skipIf(!urls)('goals over HTTP (real database)', () => {
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
  let mia: Person; // manager of dan, leads team one
  let ron: Person; // manager of nobody, leads team two
  let dan: Person; // member of team one
  let eve: Person; // member of team one, manager is nobody
  let gus: Person; // member of team two
  let deputy: Person; // manager, plain member of team one (not its lead)
  let teamOne: string;
  let teamTwo: string;
  const today = todayIn(ZONE);

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
  const create = (who: Member, body: object) =>
    who.agent.post(`${api}/goals`).send({ scope: 'personal', title: 'Learn Rust', ...body });
  const made = async (who: Member, body: object = {}) => {
    const res = await create(who, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return goalDetailSchema.parse(res.body);
  };
  const open = (who: Member, id: string) => who.agent.get(`${api}/goals/${id}`);
  const patch = (who: Member, id: string, body: object) =>
    who.agent.patch(`${api}/goals/${id}`).send(body);
  const listOf = async (who: Member, query: object = {}) => {
    const res = await who.agent
      .get(`${api}/goals`)
      .query({ status: 'all', pageSize: 100, ...query });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return goalListSchema.parse(res.body);
  };
  const ids = async (who: Member, query: object = {}) =>
    (await listOf(who, query)).items.map((g) => g.id);
  const addKr = (who: Member, goalId: string, body: object) =>
    who.agent
      .post(`${api}/goals/${goalId}/key-results`)
      .send({ title: 'Users', targetValue: 100, ...body });
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
    deputy = await onboard(acme, 'deputy', 'manager');
    const manage = await acme.admin.agent
      .put(`${api}/org/employees/${dan.employeeId}/assignment`)
      .send({ managerId: mia.employeeId, departmentId: null });
    expect(manage.status).toBe(204);
    const dept = await system.department.create({ data: { tenantId: acme.tenantId, name: 'Eng' } });
    const one = await system.team.create({
      data: {
        tenantId: acme.tenantId,
        name: 'Team one',
        departmentId: dept.id,
        leadEmployeeId: mia.employeeId,
      },
    });
    const two = await system.team.create({
      data: {
        tenantId: acme.tenantId,
        name: 'Team two',
        departmentId: dept.id,
        leadEmployeeId: ron.employeeId,
      },
    });
    teamOne = one.id;
    teamTwo = two.id;
    for (const [team, who] of [
      [teamOne, dan],
      [teamOne, eve],
      [teamOne, deputy],
      [teamTwo, gus],
    ] as const) {
      await system.teamMember.create({
        data: { tenantId: acme.tenantId, teamId: team, employeeId: who.employeeId },
      });
    }
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe('setting goals', () => {
    it('lets people set their own personal goal, with the defaults', async () => {
      const g = await made(dan, { description: 'By the summer' });
      expect(g).toMatchObject({
        scope: 'personal',
        owner: { id: dan.employeeId },
        team: null,
        title: 'Learn Rust',
        description: 'By the summer',
        status: 'active',
        dueDate: null,
        progressPct: 0,
        manualProgressPct: 0,
        keyResultCount: 0,
        overdue: false,
        parent: null,
        canEdit: true,
        keyResults: [],
        updates: [],
        children: [],
      });
    });

    it('lets a manager set a goal for a report (who is told), but not for people outside their line', async () => {
      const g = await made(mia, { employeeId: dan.employeeId, title: 'Mentor a junior' });
      expect(g.owner.id).toBe(dan.employeeId);
      const note = (await notesOf(dan)).find((n) => n.type === 'goal.assigned')!;
      expect(note.params).toEqual({ goalId: g.id });
      for (const body of [{ employeeId: ron.employeeId }, { employeeId: eve.employeeId }]) {
        const res = await create(mia, body);
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      }
      // setting your own is not announced to yourself
      expect((await notesOf(mia)).filter((n) => n.type === 'goal.assigned')).toEqual([]);
    });

    it('lets HR and Admin set goals for anyone, and refuses employees for others', async () => {
      expect((await create(hr, { employeeId: eve.employeeId })).status).toBe(201);
      expect((await create(acme.admin, { employeeId: gus.employeeId })).status).toBe(201);
      const res = await create(dan, { employeeId: eve.employeeId });
      expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      const unknown = await create(hr, { employeeId: UNKNOWN });
      expect([unknown.status, errorBody(unknown).details?.[0]?.code]).toEqual([
        400,
        'unknown_employee',
      ]);
    });

    it('lets the lead of a team, HR and Admin set team goals, nobody else', async () => {
      const g = await made(mia, { scope: 'team', teamId: teamOne, title: 'Ship v2' });
      expect(g).toMatchObject({
        scope: 'team',
        team: { id: teamOne, name: 'Team one' },
        canEdit: true,
      });
      expect((await create(hr, { scope: 'team', teamId: teamTwo })).status).toBe(201);
      for (const [who, teamId] of [
        [mia, teamTwo],
        [dan, teamOne],
        [eve, teamOne],
        [ron, teamOne],
      ] as const) {
        const res = await create(who, { scope: 'team', teamId });
        expect([res.status, errorBody(res).code], who.email).toEqual([403, 'FORBIDDEN']);
      }
      const unknown = await create(hr, { scope: 'team', teamId: UNKNOWN });
      expect([unknown.status, errorBody(unknown).details?.[0]?.code]).toEqual([
        400,
        'unknown_team',
      ]);
    });

    it('lets only HR and Admin set company goals', async () => {
      expect((await made(hr, { scope: 'company', title: 'Grow 20 %' })).canEdit).toBe(true);
      expect((await create(acme.admin, { scope: 'company' })).status).toBe(201);
      for (const who of [mia, dan, gus]) {
        const res = await create(who, { scope: 'company' });
        expect([res.status, errorBody(res).code], who.email).toEqual([403, 'FORBIDDEN']);
      }
    });

    it('lists the teams a person may set goals for', async () => {
      const teams = async (who: Member) =>
        goalTeamsSchema
          .parse((await who.agent.get(`${api}/goals/teams`)).body)
          .items.map((t) => t.name);
      expect(await teams(mia)).toEqual(['Team one']);
      expect(await teams(ron)).toEqual(['Team two']);
      expect(await teams(hr)).toEqual(['Team one', 'Team two']);
      expect(await teams(dan)).toEqual([]);
    });

    it.each([
      ['no title', { title: ' ' }],
      ['a long title', { title: 'x'.repeat(121) }],
      ['a long description', { description: 'x'.repeat(1001) }],
      ['a team goal without a team', { scope: 'team' }],
      ['a team on a personal goal', { teamId: UNKNOWN }],
      ['an unknown status', { status: 'blocked' }],
      ['progress over 100', { progressPct: 101 }],
      ['a bad date', { dueDate: '1.2.2027' }],
      ['unknown fields', { weight: 3 }],
    ])('refuses %s', async (_label, patchBody) => {
      const res = await create(dan, patchBody);
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });
  });

  describe('team members who are not the lead', () => {
    it('can see but not change team goals, even as a manager', async () => {
      const team = await made(mia, { scope: 'team', teamId: teamOne });
      await addKr(mia, team.id, {});
      expect((await open(deputy, team.id)).status).toBe(200);
      const edit = await patch(deputy, team.id, { title: 'Hijack' });
      expect([edit.status, errorBody(edit).code]).toEqual([403, 'FORBIDDEN']);
      expect((await addKr(deputy, team.id, {})).status).toBe(403);
      expect((await deputy.agent.delete(`${api}/goals/${team.id}`)).status).toBe(403);
      expect((await create(deputy, { scope: 'team', teamId: teamOne })).status).toBe(403);
      expect((await open(mia, team.id)).body.title).toBe(team.title);
    });

    it('does not reach a key result through another goal', async () => {
      const a = await made(dan, { title: 'A' });
      const b = await made(dan, { title: 'B' });
      const kr = goalDetailSchema.parse((await addKr(dan, a.id, {})).body).keyResults[0]!;
      const url = `${api}/goals/${b.id}/key-results/${kr.id}`;
      expect((await dan.agent.patch(url).send({ currentValue: 5 })).status).toBe(404);
      expect((await dan.agent.delete(url)).status).toBe(404);
      const after = goalDetailSchema.parse((await open(dan, a.id)).body);
      expect(after.keyResults[0]).toMatchObject({ id: kr.id, currentValue: 0 });
    });

    it('tells the owner once and gives an inactive owner no goal', async () => {
      const own = await made(eve, { title: 'Self set' });
      expect(
        (await notesOf(eve)).filter(
          (n) => n.type === 'goal.assigned' && n.params.goalId === own.id,
        ),
      ).toEqual([]);
      const leaver = await onboard(acme, 'gone');
      const g = await made(hr, { employeeId: leaver.employeeId });
      expect(
        (await notesOf(leaver)).filter(
          (n) => n.type === 'goal.assigned' && n.params.goalId === g.id,
        ),
      ).toHaveLength(1);
      expect(
        (await acme.admin.agent.post(`${api}/employees/${leaver.employeeId}/deactivate`).send({}))
          .status,
      ).toBeLessThan(300);
      const res = await create(hr, { employeeId: leaver.employeeId });
      expect([res.status, errorBody(res).details?.[0]?.code]).toEqual([400, 'unknown_employee']);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('who sees which goals', () => {
    it('shows personal goals to the owner and the people whose scope reaches them, nobody else', async () => {
      const g = await made(dan, { title: 'Private-ish' });
      for (const who of [dan, mia, hr, acme.admin]) {
        expect((await open(who, g.id)).status, who.email).toBe(200);
        expect(await ids(who)).toContain(g.id);
      }
      for (const who of [eve, ron, gus, globex.admin]) {
        const res = await open(who, g.id);
        expect([res.status, errorBody(res).code], who.email).toEqual([404, 'NOT_FOUND']);
        expect(await ids(who)).not.toContain(g.id);
      }
    });

    it('shows team goals to the team and to HR/Admin', async () => {
      const g = await made(mia, { scope: 'team', teamId: teamOne, title: 'Team one goal' });
      for (const who of [mia, dan, eve, hr, acme.admin]) {
        expect((await open(who, g.id)).status, who.email).toBe(200);
      }
      for (const who of [ron, gus]) {
        expect((await open(who, g.id)).status, who.email).toBe(404);
        expect(await ids(who)).not.toContain(g.id);
      }
      // the member sees it but cannot change it
      expect(goalDetailSchema.parse((await open(dan, g.id)).body).canEdit).toBe(false);
    });

    it('shows company goals to everybody', async () => {
      const g = await made(hr, { scope: 'company', title: 'For all' });
      for (const who of [dan, eve, gus, ron, mia])
        expect(await ids(who), who.email).toContain(g.id);
      expect(goalDetailSchema.parse((await open(gus, g.id)).body).canEdit).toBe(false);
    });

    it('filters by scope, status, team, person and text, and pages', async () => {
      const f = await made(dan, {
        title: 'Filterable zebra',
        status: 'draft',
        dueDate: addDays(today, 10),
      });
      await made(dan, { title: 'Finished zebra', status: 'done' });
      expect(await ids(dan, { scope: 'company' })).not.toContain(f.id);
      expect(await ids(dan, { scope: 'personal', q: 'zebra' })).toHaveLength(2);
      expect(await ids(dan, { q: 'FILTERABLE' })).toEqual([f.id]);
      expect(await ids(dan, { q: '_' })).toEqual([]); // wildcards are matched literally
      expect((await listOf(hr, { q: '%' })).items.every((g) => g.title.includes('%'))).toBe(true);
      expect(await ids(dan, { q: 'zebra', status: 'open' })).toEqual([f.id]); // draft counts as open
      expect((await listOf(dan, { q: 'zebra', status: 'done' })).items.map((g) => g.title)).toEqual(
        ['Finished zebra'],
      );
      expect(await ids(mia, { employeeId: dan.employeeId, q: 'zebra' })).toHaveLength(2);
      expect(
        (await listOf(hr, { teamId: teamTwo })).items.every((g) => g.team?.id === teamTwo),
      ).toBe(true);
      const first = await listOf(dan, { pageSize: 2 });
      const second = await listOf(dan, { pageSize: 2, page: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.total).toBeGreaterThan(2);
      expect(second.items.map((g) => g.id)).not.toEqual(first.items.map((g) => g.id));
      expect((await dan.agent.get(`${api}/goals`).query({ scope: 'region' })).status).toBe(400);
    });

    it('flags open goals past their due date, not on the day and not finished ones', async () => {
      const late = await made(dan, { title: 'Late', dueDate: addDays(today, -1) });
      const onTheDay = await made(dan, { title: 'Due today', dueDate: today });
      const finished = await made(dan, {
        title: 'Late but done',
        dueDate: addDays(today, -5),
        status: 'done',
      });
      const overdue = async (id: string) =>
        goalDetailSchema.parse((await open(dan, id)).body).overdue;
      expect([
        await overdue(late.id),
        await overdue(onTheDay.id),
        await overdue(finished.id),
      ]).toEqual([true, false, false]);
    });

    it('orders by due date, goals without one last', async () => {
      const d = await made(dan, { title: 'Order test A', dueDate: addDays(today, 40) });
      const e = await made(dan, { title: 'Order test B', dueDate: addDays(today, 20) });
      const n = await made(dan, { title: 'Order test C' });
      const order = (await listOf(dan, { q: 'Order test' })).items.map((g) => g.id);
      expect(order).toEqual([e.id, d.id, n.id]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('changing goals', () => {
    it('lets the owner and their manager change a goal, and clear optional fields', async () => {
      const g = await made(dan, { dueDate: addDays(today, 30), description: 'x' });
      const res = await patch(dan, g.id, {
        title: 'Learn Go',
        status: 'done',
        dueDate: null,
        description: '',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(goalDetailSchema.parse(res.body)).toMatchObject({
        title: 'Learn Go',
        status: 'done',
        dueDate: null,
        description: null,
      });
      expect((await patch(mia, g.id, { progressPct: 60 })).status).toBe(200);
      expect((await patch(hr, g.id, { title: 'By HR' })).status).toBe(200);
    });

    it('refuses people who see a goal but may not change it, and hides it from the rest', async () => {
      const team = await made(mia, { scope: 'team', teamId: teamOne });
      for (const who of [dan, eve]) {
        const res = await patch(who, team.id, { title: 'x' });
        expect([res.status, errorBody(res).code], who.email).toEqual([403, 'FORBIDDEN']);
      }
      const personal = await made(dan);
      for (const who of [eve, ron, gus, globex.admin]) {
        expect((await patch(who, personal.id, { title: 'x' })).status, who.email).toBe(404);
      }
      expect((await patch(dan, UNKNOWN, { title: 'x' })).status).toBe(404);
      for (const body of [
        {},
        { title: ' ' },
        { scope: 'company' },
        { progressPct: 101 },
        { status: 'x' },
      ]) {
        expect((await patch(dan, personal.id, body)).status).toBe(400);
      }
    });

    it('does not let a manager change a goal of somebody outside their line', async () => {
      const g = await made(eve);
      const res = await patch(mia, g.id, { title: 'x' });
      expect([404, 403]).toContain(res.status); // mia cannot even see it
      expect((await patch(ron, g.id, { title: 'x' })).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('alignment', () => {
    it('aligns to a wider goal the person can see, and nothing else', async () => {
      const company = await made(hr, { scope: 'company', title: 'Company aim' });
      const team = await made(mia, {
        scope: 'team',
        teamId: teamOne,
        title: 'Team aim',
        parentGoalId: company.id,
      });
      const mine = await made(dan, { title: 'My aim', parentGoalId: team.id });
      expect(mine.parent).toEqual({ id: team.id, title: 'Team aim', scope: 'team' });
      expect(
        (await made(dan, { title: 'Straight to company', parentGoalId: company.id })).parent?.id,
      ).toBe(company.id);

      const reject = async (who: Member, body: object, code: string) => {
        const res = await create(who, body);
        expect([res.status, errorBody(res).details?.[0]?.code], JSON.stringify(body)).toEqual([
          400,
          code,
        ]);
      };
      await reject(dan, { parentGoalId: mine.id }, 'parent_not_wider'); // personal → personal
      await reject(
        mia,
        { scope: 'team', teamId: teamOne, parentGoalId: team.id },
        'parent_not_wider',
      );
      await reject(hr, { scope: 'company', parentGoalId: company.id }, 'parent_not_wider');
      await reject(hr, { scope: 'company', parentGoalId: team.id }, 'parent_not_wider');
      await reject(dan, { parentGoalId: UNKNOWN }, 'parent_not_found');
      // a team goal of another team is invisible to dan
      const other = await made(hr, { scope: 'team', teamId: teamTwo });
      await reject(dan, { parentGoalId: other.id }, 'parent_not_found');
    });

    it('changes and clears the alignment, with the same rules', async () => {
      const company = await made(hr, { scope: 'company', title: 'C2' });
      const team = await made(mia, { scope: 'team', teamId: teamOne, title: 'T2' });
      const mine = await made(dan, { title: 'M2' });
      expect(
        goalDetailSchema.parse((await patch(dan, mine.id, { parentGoalId: team.id })).body).parent
          ?.id,
      ).toBe(team.id);
      expect(
        goalDetailSchema.parse((await patch(dan, mine.id, { parentGoalId: null })).body).parent,
      ).toBeNull();
      const sideways = await patch(dan, mine.id, { parentGoalId: mine.id });
      expect(errorBody(sideways).details?.[0]?.code).toBe('parent_not_wider');
      const down = await patch(hr, company.id, { parentGoalId: team.id });
      expect(errorBody(down).details?.[0]?.code).toBe('parent_not_wider');
    });

    it('lists aligned goals the viewer may see under their parent, and hides the others', async () => {
      const company = await made(hr, { scope: 'company', title: 'Parent for list' });
      const a = await made(dan, { title: 'Dans child', parentGoalId: company.id });
      const b = await made(eve, { title: 'Eves child', parentGoalId: company.id });
      const asDan = goalDetailSchema.parse((await open(dan, company.id)).body);
      expect(asDan.children.map((c) => c.id)).toEqual([a.id]);
      const asHr = goalDetailSchema.parse((await open(hr, company.id)).body);
      expect(asHr.children.map((c) => c.id)).toEqual([a.id, b.id]);
    });

    it('keeps a goal with aligned goals from being deleted', async () => {
      const company = await made(hr, { scope: 'company', title: 'Cannot vanish' });
      const child = await made(dan, { title: 'Child', parentGoalId: company.id });
      const res = await hr.agent.delete(`${api}/goals/${company.id}`);
      expect([res.status, errorBody(res).code, errorBody(res).params?.field]).toEqual([
        409,
        'CONFLICT',
        'children',
      ]);
      expect((await dan.agent.delete(`${api}/goals/${child.id}`)).status).toBe(204);
      expect((await hr.agent.delete(`${api}/goals/${company.id}`)).status).toBe(204);
    });

    it('lets goals go free when their team disappears', async () => {
      const team = await system.team.create({
        data: {
          tenantId: acme.tenantId,
          name: 'Short-lived',
          departmentId: (
            await system.department.findFirstOrThrow({ where: { tenantId: acme.tenantId } })
          ).id,
        },
      });
      await system.teamMember.create({
        data: { tenantId: acme.tenantId, teamId: team.id, employeeId: dan.employeeId },
      });
      const g = await made(hr, { scope: 'team', teamId: team.id, title: 'Will vanish' });
      const child = await made(dan, { title: 'Survivor', parentGoalId: g.id });
      expect((await acme.admin.agent.delete(`${api}/org/teams/${team.id}`)).status).toBe(204);
      expect((await open(hr, g.id)).status).toBe(404);
      expect(goalDetailSchema.parse((await open(dan, child.id)).body).parent).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('key results and progress', () => {
    it('computes the progress of a goal from its key results, ignoring the manual value', async () => {
      const g = await made(dan, { progressPct: 90 });
      expect(g.progressPct).toBe(90);
      const one = goalDetailSchema.parse(
        (await addKr(dan, g.id, { title: 'Users', targetValue: 100, currentValue: 50 })).body,
      );
      expect(one.keyResults[0]).toMatchObject({
        title: 'Users',
        startValue: 0,
        targetValue: 100,
        currentValue: 50,
        progressPct: 50,
      });
      expect(one).toMatchObject({ progressPct: 50, manualProgressPct: 90, keyResultCount: 1 });
      const two = goalDetailSchema.parse(
        (await addKr(dan, g.id, { title: 'Bugs', startValue: 40, targetValue: 0, unit: 'open' }))
          .body,
      );
      expect(two.keyResults[1]).toMatchObject({ unit: 'open', currentValue: 40, progressPct: 0 }); // a goal to reduce
      expect(two.progressPct).toBe(25);
      const kr = two.keyResults[1]!;
      const moved = goalDetailSchema.parse(
        (
          await dan.agent
            .patch(`${api}/goals/${g.id}/key-results/${kr.id}`)
            .send({ currentValue: 10 })
        ).body,
      );
      expect(moved.keyResults[1]!.progressPct).toBe(75);
      expect(moved.progressPct).toBe(63); // (50 + 75) / 2 = 62.5
      const removed = goalDetailSchema.parse(
        (await dan.agent.delete(`${api}/goals/${g.id}/key-results/${kr.id}`)).body,
      );
      expect(removed.progressPct).toBe(50);
      const gone = goalDetailSchema.parse(
        (await dan.agent.delete(`${api}/goals/${g.id}/key-results/${removed.keyResults[0]!.id}`))
          .body,
      );
      expect(gone).toMatchObject({ keyResultCount: 0, progressPct: 90 }); // back to the manual value
    });

    it('keeps the order, caps at ten, and refuses bad values', async () => {
      const g = await made(dan);
      for (let i = 0; i < 10; i++)
        expect((await addKr(dan, g.id, { title: `KR ${i}` })).status).toBe(201);
      const titles = goalDetailSchema
        .parse((await open(dan, g.id)).body)
        .keyResults.map((k) => k.title);
      expect(titles).toEqual(Array.from({ length: 10 }, (_, i) => `KR ${i}`));
      const eleventh = await addKr(dan, g.id, {});
      expect([eleventh.status, errorBody(eleventh).details?.[0]?.code]).toEqual([400, 'too_many']);
      const other = await made(dan);
      for (const body of [
        { title: ' ' },
        { targetValue: 0 }, // equal to the start
        { targetValue: 2e9 },
        { unit: 'x'.repeat(21) },
        { currentValue: 'x' },
        { extra: 1 },
      ]) {
        expect((await addKr(dan, other.id, body)).status, JSON.stringify(body)).toBe(400);
      }
    });

    it('refuses a change that makes the target equal to the start', async () => {
      const g = await made(dan);
      const kr = goalDetailSchema.parse((await addKr(dan, g.id, { targetValue: 10 })).body)
        .keyResults[0]!;
      const url = `${api}/goals/${g.id}/key-results/${kr.id}`;
      for (const body of [{ startValue: 10 }, { targetValue: 0 }]) {
        const res = await dan.agent.patch(url).send(body);
        expect([res.status, errorBody(res).details?.[0]?.code], JSON.stringify(body)).toEqual([
          400,
          'same_as_start',
        ]);
      }
      expect(
        (await dan.agent.patch(url).send({ startValue: 5, targetValue: 15, unit: ' ' })).status,
      ).toBe(200);
      expect((await dan.agent.patch(url).send({})).status).toBe(400);
      expect(
        (
          await dan.agent
            .patch(`${api}/goals/${g.id}/key-results/${UNKNOWN}`)
            .send({ currentValue: 1 })
        ).status,
      ).toBe(404);
      expect((await dan.agent.delete(`${api}/goals/${g.id}/key-results/${UNKNOWN}`)).status).toBe(
        404,
      );
    });

    it('follows the rights of the goal: owner and manager yes, the team no, strangers 404', async () => {
      const mine = await made(dan);
      expect((await addKr(mia, mine.id, {})).status).toBe(201);
      expect((await addKr(hr, mine.id, {})).status).toBe(201);
      for (const who of [eve, ron, gus])
        expect((await addKr(who, mine.id, {})).status, who.email).toBe(404);
      const team = await made(mia, { scope: 'team', teamId: teamOne });
      expect((await addKr(mia, team.id, {})).status).toBe(201);
      const refused = await addKr(dan, team.id, {});
      expect([refused.status, errorBody(refused).code]).toEqual([403, 'FORBIDDEN']);
      const kr = goalDetailSchema.parse((await open(mia, team.id)).body).keyResults[0]!;
      for (const res of [
        await dan.agent
          .patch(`${api}/goals/${team.id}/key-results/${kr.id}`)
          .send({ currentValue: 1 }),
        await dan.agent.delete(`${api}/goals/${team.id}/key-results/${kr.id}`),
      ]) {
        expect(res.status).toBe(403);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('check-ins', () => {
    it('records the progress at that moment and a comment, newest first', async () => {
      const g = await made(dan, { progressPct: 20 });
      const first = goalDetailSchema.parse(
        (await dan.agent.post(`${api}/goals/${g.id}/updates`).send({ comment: ' started ' })).body,
      );
      expect(first.updates).toHaveLength(1);
      expect(first.updates[0]).toMatchObject({
        progressPct: 20,
        comment: 'started',
        author: { id: dan.employeeId },
      });
      await patch(dan, g.id, { progressPct: 70 });
      const second = goalDetailSchema.parse(
        (await mia.agent.post(`${api}/goals/${g.id}/updates`).send({})).body,
      );
      expect(second.updates.map((u) => [u.progressPct, u.comment, u.author.id])).toEqual([
        [70, null, mia.employeeId],
        [20, 'started', dan.employeeId],
      ]);
      // later edits do not rewrite history
      await patch(dan, g.id, { progressPct: 100 });
      expect(
        goalDetailSchema.parse((await open(dan, g.id)).body).updates.map((u) => u.progressPct),
      ).toEqual([70, 20]);
    });

    it('is for people who may change the goal; refuses long comments', async () => {
      const g = await made(dan);
      const team = await made(mia, { scope: 'team', teamId: teamOne });
      expect((await dan.agent.post(`${api}/goals/${team.id}/updates`).send({})).status).toBe(403);
      expect((await eve.agent.post(`${api}/goals/${g.id}/updates`).send({})).status).toBe(404);
      expect(
        (await dan.agent.post(`${api}/goals/${g.id}/updates`).send({ comment: 'x'.repeat(501) }))
          .status,
      ).toBe(400);
      expect(
        (await dan.agent.post(`${api}/goals/${g.id}/updates`).send({ progress: 5 })).status,
      ).toBe(400);
      expect((await dan.agent.post(`${api}/goals/${UNKNOWN}/updates`).send({})).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('deleting goals', () => {
    it('lets those who may change a goal delete it, with its key results and check-ins', async () => {
      const g = await made(dan);
      await addKr(dan, g.id, {});
      await dan.agent.post(`${api}/goals/${g.id}/updates`).send({});
      expect((await eve.agent.delete(`${api}/goals/${g.id}`)).status).toBe(404);
      expect((await dan.agent.delete(`${api}/goals/${g.id}`)).status).toBe(204);
      expect((await dan.agent.delete(`${api}/goals/${g.id}`)).status).toBe(404);
      expect(await system.keyResult.count({ where: { goalId: g.id } })).toBe(0);
      expect(await system.goalUpdate.count({ where: { goalId: g.id } })).toBe(0);
      const team = await made(mia, { scope: 'team', teamId: teamOne });
      expect((await dan.agent.delete(`${api}/goals/${team.id}`)).status).toBe(403);
      expect((await mia.agent.delete(`${api}/goals/${team.id}`)).status).toBe(204);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('audit, privacy and offboarding', () => {
    it('audits ids, scope and field names, never titles or comments', async () => {
      const g = await made(dan, { title: 'Sensitive title', description: 'Sensitive description' });
      await patch(dan, g.id, { title: 'Another sensitive title' });
      await dan.agent.post(`${api}/goals/${g.id}/updates`).send({ comment: 'Sensitive comment' });
      await dan.agent.delete(`${api}/goals/${g.id}`);
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: { startsWith: 'goal.' } },
      });
      expect(new Set(entries.map((e) => e.action))).toEqual(
        new Set(['goal.created', 'goal.updated', 'goal.deleted', 'goal.key_result_changed']),
      );
      expect(JSON.stringify(entries)).not.toMatch(/Sensitive|sensitive/);
    });

    it('cancels the open personal goals of a leaver, and leaves finished ones', async () => {
      const leaver = await onboard(acme, 'leaver');
      const open1 = await made(leaver, { title: 'Open' });
      const draft = await made(leaver, { title: 'Draft', status: 'draft' });
      const done = await made(leaver, { title: 'Done', status: 'done' });
      const res = await hr.agent
        .post(`${api}/employees/${leaver.employeeId}/deactivate`)
        .send({ terminationDate: today });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const status = async (id: string) =>
        (await system.goal.findUniqueOrThrow({ where: { id } })).status;
      expect([await status(open1.id), await status(draft.id), await status(done.id)]).toEqual([
        'cancelled',
        'cancelled',
        'done',
      ]);
    });

    it('lists goals and check-ins in the data export', async () => {
      const person = await onboard(acme, 'exporter');
      const g = await made(person, {
        title: 'Export me',
        description: 'details',
        dueDate: addDays(today, 5),
      });
      await addKr(person, g.id, { title: 'Pages', unit: 'p', targetValue: 10, currentValue: 5 });
      await person.agent.post(`${api}/goals/${g.id}/updates`).send({ comment: 'half way' });
      const doc = personalDataExportSchema.parse(
        (await person.agent.get(`${api}/privacy/export`)).body,
      );
      expect(doc.goals.personal).toEqual([
        {
          title: 'Export me',
          description: 'details',
          status: 'active',
          dueDate: addDays(today, 5),
          progressPct: 0,
          keyResults: [
            { title: 'Pages', unit: 'p', startValue: 0, targetValue: 10, currentValue: 5 },
          ],
        },
      ]);
      expect(doc.goals.checkIns).toEqual([
        { goal: 'Export me', progressPct: 50, comment: 'half way', createdAt: expect.any(String) },
      ]);
      const empty = personalDataExportSchema.parse(
        (await gus.agent.get(`${api}/privacy/export`)).body,
      );
      expect(empty.goals.personal.every((p) => p.title !== 'Export me')).toBe(true);
    });

    it('erases the personal goals and the check-in comments of a former employee', async () => {
      const boss = await onboard(acme, 'oldboss', 'manager');
      await acme.admin.agent
        .put(`${api}/org/employees/${eve.employeeId}/assignment`)
        .send({ managerId: boss.employeeId, departmentId: null });
      const bosses = await made(boss, { title: 'Boss goal' });
      const evesGoal = await made(eve, { title: 'Eve goal' });
      const checked = await boss.agent
        .post(`${api}/goals/${evesGoal.id}/updates`)
        .send({ comment: 'Well done, Eve' });
      expect(checked.status, JSON.stringify(checked.body)).toBe(201);
      await acme.admin.agent
        .put(`${api}/org/employees/${eve.employeeId}/assignment`)
        .send({ managerId: null, departmentId: null });
      expect(
        (
          await hr.agent
            .post(`${api}/employees/${boss.employeeId}/deactivate`)
            .send({ terminationDate: today })
        ).status,
      ).toBe(200);
      const erased = await hr.agent
        .post(`${api}/privacy/erase/${boss.employeeId}`)
        .send({ confirm: true });
      expect(erased.status, JSON.stringify(erased.body)).toBeLessThan(300);
      expect(await system.goal.findUnique({ where: { id: bosses.id } })).toBeNull();
      const rows = await system.goalUpdate.findMany({ where: { goalId: evesGoal.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ comment: null, progressPct: 0 });
      expect(await system.goal.findUnique({ where: { id: evesGoal.id } })).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('tenant isolation and database rules', () => {
    it('keeps another workspace away from goals, in lists and in every write', async () => {
      const g = await made(hr, { scope: 'company', title: 'Acme only' });
      const k = goalDetailSchema.parse((await addKr(hr, g.id, {})).body).keyResults[0]!;
      const x = globex.admin;
      expect(await ids(x)).not.toContain(g.id);
      for (const res of [
        await open(x, g.id),
        await patch(x, g.id, { title: 'x' }),
        await x.agent.delete(`${api}/goals/${g.id}`),
        await addKr(x, g.id, {}),
        await x.agent.patch(`${api}/goals/${g.id}/key-results/${k.id}`).send({ currentValue: 1 }),
        await x.agent.post(`${api}/goals/${g.id}/updates`).send({}),
      ]) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      const team = await create(x, { scope: 'team', teamId: teamOne });
      expect(errorBody(team).details?.[0]?.code).toBe('unknown_team');
      const parent = await create(x, { scope: 'personal', parentGoalId: g.id });
      expect(errorBody(parent).details?.[0]?.code).toBe('parent_not_found');
    });

    it('enforces the rules in the database when the application is bypassed', async () => {
      const base = { tenantId: acme.tenantId, ownerEmployeeId: dan.employeeId, title: 'Rules' };
      const refuse = (data: object) =>
        expect(
          system.goal.create({ data: { ...base, scope: 'personal', ...data } as never }),
        ).rejects.toThrow();
      await refuse({ scope: 'region' });
      await refuse({ status: 'blocked' });
      await refuse({ scope: 'team' }); // a team goal without a team
      await refuse({ teamId: teamOne });
      await refuse({ progressPct: 101 });
      await refuse({ progressPct: -1 });
      await refuse({ title: '' });
      await refuse({ title: 'x'.repeat(121) });
      await refuse({ description: 'x'.repeat(1001) });
      const company = await system.goal.create({ data: { ...base, scope: 'company' } });
      const personal = await system.goal.create({ data: { ...base, scope: 'personal' } });
      await refuse({ parentGoalId: personal.id }); // not wider
      await expect(
        system.goal.update({ where: { id: company.id }, data: { parentGoalId: personal.id } }),
      ).rejects.toThrow(); // a company goal under a personal one
      await expect(
        system.goal.update({ where: { id: personal.id }, data: { parentGoalId: personal.id } }),
      ).rejects.toThrow(); // its own parent
      await system.goal.update({ where: { id: personal.id }, data: { parentGoalId: company.id } }); // fine
      const kr = { tenantId: acme.tenantId, goalId: personal.id, title: 'KR' };
      await expect(
        system.keyResult.create({
          data: { ...kr, startValue: 1, targetValue: 1, currentValue: 1 },
        }),
      ).rejects.toThrow();
      await expect(
        system.keyResult.create({ data: { ...kr, targetValue: 2e9, currentValue: 0 } }),
      ).rejects.toThrow();
      await expect(
        system.keyResult.create({ data: { ...kr, title: '', targetValue: 1, currentValue: 0 } }),
      ).rejects.toThrow();
      await expect(
        system.goalUpdate.create({
          data: {
            tenantId: acme.tenantId,
            goalId: personal.id,
            authorEmployeeId: dan.employeeId,
            progressPct: 101,
          },
        }),
      ).rejects.toThrow();
      await expect(
        system.goalUpdate.create({
          data: {
            tenantId: acme.tenantId,
            goalId: personal.id,
            authorEmployeeId: dan.employeeId,
            progressPct: 5,
            comment: 'x'.repeat(501),
          },
        }),
      ).rejects.toThrow();
      const foreign = await system.employee.findFirstOrThrow({
        where: { tenantId: globex.tenantId },
      });
      await expect(
        system.goal.create({ data: { ...base, scope: 'personal', ownerEmployeeId: foreign.id } }),
      ).rejects.toThrow(); // an owner of another workspace
    });
  });
});
