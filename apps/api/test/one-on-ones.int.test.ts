import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  employeeSchema,
  oneOnOneDetailSchema,
  oneOnOneListSchema,
  oneOnOnePeopleSchema,
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

describe.skipIf(!urls)('1:1 meetings over HTTP (real database)', () => {
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
  let hr: Person; // manager of mia
  let mia: Person; // manager of dan and eve
  let ron: Person; // manager role, no manager, no reports
  let dan: Person; // report of mia
  let eve: Person; // report of mia
  let gus: Person; // employee without a manager
  const today = todayIn(ZONE);
  const soon = addDays(today, 3);

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
  const assign = async (who: Person, managerId: string | null) => {
    const res = await acme.admin.agent
      .put(`${api}/org/employees/${who.employeeId}/assignment`)
      .send({ managerId, departmentId: null });
    expect(res.status).toBe(204);
  };
  const create = (who: Member, body: object = {}) =>
    who.agent.post(`${api}/one-on-ones`).send({ date: soon, time: '10:00', ...body });
  const made = async (who: Member, body: object = {}) => {
    const res = await create(who, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return oneOnOneDetailSchema.parse(res.body);
  };
  const open = (who: Member, id: string) => who.agent.get(`${api}/one-on-ones/${id}`);
  const patch = (who: Member, id: string, body: object) =>
    who.agent.patch(`${api}/one-on-ones/${id}`).send(body);
  const listOf = async (who: Member, query: object = {}) => {
    const res = await who.agent.get(`${api}/one-on-ones`).query({ status: 'all', ...query });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return oneOnOneListSchema.parse(res.body);
  };
  const ids = async (who: Member, query: object = {}) =>
    (await listOf(who, { pageSize: 100, ...query })).items.map((m) => m.id);
  const item = (who: Member, id: string, body: object = {}) =>
    who.agent.post(`${api}/one-on-ones/${id}/action-items`).send({ title: 'Send notes', ...body });
  const notesOf = async (who: Member) => {
    await app.get(OutboxWorker).runOnce();
    return (await who.agent.get(`${api}/notifications`)).body.items as {
      type: string;
      params: Record<string, unknown>;
    }[];
  };
  const changes = async (who: Member, meetingId: string) =>
    (await notesOf(who))
      .filter((n) => n.type === 'one_on_one.changed' && n.params.meetingId === meetingId)
      .map((n) => n.params);

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
    await assign(mia, hr.employeeId);
    await assign(dan, mia.employeeId);
    await assign(eve, mia.employeeId);
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe('scheduling', () => {
    it('lets an employee schedule a 1:1 with their manager, who is told', async () => {
      const m = await made(dan, { agenda: ' Career ' });
      expect(m).toMatchObject({
        role: 'employee',
        other: { id: mia.employeeId },
        manager: { id: mia.employeeId },
        employee: { id: dan.employeeId },
        date: soon,
        time: '10:00',
        durationMinutes: 30,
        status: 'scheduled',
        agenda: 'Career',
        sharedNotes: null,
        privateNotes: null,
        actionItems: [],
        openActionItems: 0,
        canEdit: true,
      });
      expect(await changes(mia, m.id)).toEqual([
        { meetingId: m.id, date: soon, action: 'scheduled' },
      ]);
      expect(await changes(dan, m.id)).toEqual([]); // not told about their own doing
    });

    it('lets a manager schedule one with a report, who is told', async () => {
      const m = await made(mia, { employeeId: eve.employeeId, durationMinutes: 45 });
      expect(m).toMatchObject({
        role: 'manager',
        other: { id: eve.employeeId },
        durationMinutes: 45,
      });
      expect(await changes(eve, m.id)).toHaveLength(1);
      // a manager is a report of their own manager too
      const up = await made(mia);
      expect(up).toMatchObject({ role: 'employee', other: { id: hr.employeeId } });
      expect((await made(hr, { employeeId: mia.employeeId })).other.id).toBe(mia.employeeId);
    });

    it('schedules with a report who has no account yet, and tells nobody', async () => {
      const res = await acme.admin.agent
        .post(`${api}/employees`)
        .send({ firstName: 'Noaccount', lastName: 'Test', employmentType: 'full_time' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const id = employeeSchema.parse(res.body).id;
      const lead = await onboard(acme, 'lead2', 'manager');
      await assign({ employeeId: id } as Person, lead.employeeId);
      const m = await made(lead, { employeeId: id });
      expect(m.other.id).toBe(id);
      expect(
        await system.outboxEvent.count({
          where: {
            tenantId: acme.tenantId,
            type: 'one_on_one.changed',
            params: { path: ['meetingId'], equals: m.id },
          },
        }),
      ).toBe(0);
    });

    it('refuses what the role or the reporting line does not allow', async () => {
      const cases: [string, Member, object, number, string][] = [
        ['no manager to meet', gus, {}, 400, 'VALIDATION_FAILED'],
        ['a manager without reports', ron, {}, 400, 'VALIDATION_FAILED'],
        ['someone else’s manager line', dan, { employeeId: eve.employeeId }, 403, 'FORBIDDEN'],
        ['an employee for their manager', dan, { employeeId: mia.employeeId }, 403, 'FORBIDDEN'],
        ['a person who is not a report', ron, { employeeId: dan.employeeId }, 403, 'FORBIDDEN'],
        ['a report of a report', hr, { employeeId: dan.employeeId }, 403, 'FORBIDDEN'],
        ['the manager of the manager', mia, { employeeId: hr.employeeId }, 403, 'FORBIDDEN'],
        ['an unknown person', mia, { employeeId: UNKNOWN }, 400, 'VALIDATION_FAILED'],
      ];
      for (const [label, who, body, status, code] of cases) {
        const res = await create(who, body);
        expect([res.status, errorBody(res).code], label).toEqual([status, code]);
      }
      expect(errorBody(await create(gus)).details?.[0]?.code).toBe('no_manager');
      expect(errorBody(await create(mia, { employeeId: UNKNOWN })).details?.[0]?.code).toBe(
        'unknown_employee',
      );
    });

    it('refuses a report who is no longer active, and a person without a manager', async () => {
      const gone = await onboard(acme, 'gone');
      await assign(gone, mia.employeeId);
      await hr.agent
        .post(`${api}/employees/${gone.employeeId}/deactivate`)
        .send({ terminationDate: today });
      const res = await create(mia, { employeeId: gone.employeeId });
      expect(errorBody(res).details?.[0]?.code).toBe('unknown_employee');
      // the workspace administrator is an employee without a manager
      expect(errorBody(await create(acme.admin)).details?.[0]?.code).toBe('no_manager');
    });

    it('stores the time as typed in the workspace time zone', async () => {
      const m = await made(dan, { date: '2027-07-01', time: '10:00' });
      expect([m.date, m.time]).toEqual(['2027-07-01', '10:00']);
      const row = await system.oneOnOne.findUniqueOrThrow({ where: { id: m.id } });
      expect(row.scheduledAt.toISOString()).toBe('2027-07-01T07:00:00.000Z'); // Sofia is UTC+3 in summer
      const winter = await made(dan, { date: '2027-01-15', time: '10:00' });
      expect(
        (
          await system.oneOnOne.findUniqueOrThrow({ where: { id: winter.id } })
        ).scheduledAt.toISOString(),
      ).toBe('2027-01-15T08:00:00.000Z');
    });

    it('refuses a time that does not exist (clocks go forward)', async () => {
      const res = await create(dan, { date: '2027-03-28', time: '03:30' });
      expect([res.status, errorBody(res).details?.[0]?.code]).toEqual([400, 'nonexistent_time']);
    });

    it('lists who can be met', async () => {
      const people = async (who: Member) =>
        oneOnOnePeopleSchema
          .parse((await who.agent.get(`${api}/one-on-ones/people`)).body)
          .items.map((p) => `${p.relation}:${p.firstName}`);
      expect(await people(dan)).toEqual(['manager:mia']);
      expect(await people(mia)).toEqual(['manager:hrx', 'report:dan', 'report:eve']);
      expect(await people(gus)).toEqual([]);
      expect(await people(hr)).toEqual(['report:mia']);
    });

    it.each([
      ['no date', { date: undefined }],
      ['a bad date', { date: '1.2.2027' }],
      ['a bad time', { time: '25:00' }],
      ['a time without a leading zero', { time: '9:00' }],
      ['a duration under 15 minutes', { durationMinutes: 14 }],
      ['a duration over 4 hours', { durationMinutes: 241 }],
      ['a long agenda', { agenda: 'x'.repeat(1001) }],
      ['unknown fields', { status: 'done' }],
    ])('refuses %s', async (_label, body) => {
      const res = await create(dan, body);
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('who sees a meeting', () => {
    it('shows it to its two people only, never to anybody else (404)', async () => {
      const m = await made(dan);
      for (const who of [dan, mia]) {
        expect((await open(who, m.id)).status, who.email).toBe(200);
        expect(await ids(who)).toContain(m.id);
      }
      // not the other report, not the manager’s manager (HR), not an administrator, not another workspace
      for (const who of [eve, hr, ron, gus, acme.admin, globex.admin]) {
        const res = await open(who, m.id);
        expect([res.status, errorBody(res).code], who.email).toEqual([404, 'NOT_FOUND']);
        expect(await ids(who)).not.toContain(m.id);
      }
    });

    it('refuses every change to a stranger, and leaves the meeting as it was', async () => {
      const m = await made(dan, { agenda: 'Mine' });
      const it1 = goalItem(await (await item(dan, m.id)).body);
      for (const who of [eve, hr, acme.admin, globex.admin]) {
        const calls = [
          await patch(who, m.id, { agenda: 'Hacked' }),
          await patch(who, m.id, { status: 'cancelled' }),
          await item(who, m.id),
          await who.agent
            .patch(`${api}/one-on-ones/${m.id}/action-items/${it1}`)
            .send({ done: true }),
          await who.agent.delete(`${api}/one-on-ones/${m.id}/action-items/${it1}`),
        ];
        for (const res of calls) expect(res.status, who.email).toBe(404);
      }
      const after = oneOnOneDetailSchema.parse((await open(dan, m.id)).body);
      expect(after).toMatchObject({ agenda: 'Mine', status: 'scheduled' });
      expect(after.actionItems).toHaveLength(1);
      expect(after.actionItems[0]!.done).toBe(false);
    });

    it('shows another workspace an empty list', async () => {
      const res = await globex.admin.agent.get(`${api}/one-on-ones`);
      expect([res.status, oneOnOneListSchema.parse(res.body).total]).toEqual([200, 0]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('notes', () => {
    it('shares the agenda and the shared notes, and keeps private notes private', async () => {
      const m = await made(dan);
      expect((await patch(dan, m.id, { agenda: 'Raise', privateNotes: 'Dan secret' })).status).toBe(
        200,
      );
      expect(
        (await patch(mia, m.id, { sharedNotes: 'Agreed', privateNotes: 'Mia secret' })).status,
      ).toBe(200);
      const asDan = oneOnOneDetailSchema.parse((await open(dan, m.id)).body);
      const asMia = oneOnOneDetailSchema.parse((await open(mia, m.id)).body);
      expect([asDan.agenda, asDan.sharedNotes, asDan.privateNotes]).toEqual([
        'Raise',
        'Agreed',
        'Dan secret',
      ]);
      expect([asMia.agenda, asMia.sharedNotes, asMia.privateNotes]).toEqual([
        'Raise',
        'Agreed',
        'Mia secret',
      ]);
      // the other person's private note is nowhere in what each receives
      expect(JSON.stringify((await open(dan, m.id)).body)).not.toContain('Mia secret');
      expect(JSON.stringify((await open(mia, m.id)).body)).not.toContain('Dan secret');
      expect(JSON.stringify((await dan.agent.get(`${api}/one-on-ones`)).body)).not.toContain(
        'secret',
      );
      const row = await system.oneOnOne.findUniqueOrThrow({ where: { id: m.id } });
      expect([row.privateNotesEmployee, row.privateNotesManager]).toEqual([
        'Dan secret',
        'Mia secret',
      ]);
    });

    it('clears a text with an empty string and limits their length', async () => {
      const m = await made(dan, { agenda: 'Something' });
      const cleared = oneOnOneDetailSchema.parse((await patch(dan, m.id, { agenda: ' ' })).body);
      expect(cleared.agenda).toBeNull();
      for (const body of [
        { sharedNotes: 'x'.repeat(2001) },
        { privateNotes: 'x'.repeat(2001) },
        { agenda: 'x'.repeat(1001) },
        {},
        { date: soon },
        { status: 'later' },
        { durationMinutes: 10 },
        { employeeId: eve.employeeId },
      ]) {
        const res = await patch(dan, m.id, body);
        expect([res.status, errorBody(res).code], JSON.stringify(body)).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
      expect((await patch(dan, m.id, { privateNotes: 'x'.repeat(2000) })).status).toBe(200);
    });

    it('never audits a meeting', async () => {
      const m = await made(dan, { agenda: 'Audit me not' });
      await patch(dan, m.id, { privateNotes: 'Audit me not either' });
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, entity: 'one_on_one' },
      });
      expect(entries).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('changing a meeting', () => {
    it('reschedules, tells the other person, and does not for an unchanged time', async () => {
      const m = await made(dan);
      const moved = oneOnOneDetailSchema.parse(
        (await patch(mia, m.id, { date: addDays(soon, 1), time: '11:30', durationMinutes: 60 }))
          .body,
      );
      expect(moved).toMatchObject({ date: addDays(soon, 1), time: '11:30', durationMinutes: 60 });
      expect(await changes(dan, m.id)).toEqual([
        { meetingId: m.id, date: addDays(soon, 1), action: 'rescheduled' },
      ]);
      await patch(mia, m.id, { date: addDays(soon, 1), time: '11:30' }); // same instant
      await patch(mia, m.id, { agenda: 'Only the agenda' });
      expect(await changes(dan, m.id)).toHaveLength(1);
      expect((await changes(mia, m.id)).map((c) => c.action)).toEqual(['scheduled']); // nothing for the mover
      const gap = await patch(mia, m.id, { date: '2027-03-28', time: '03:30' });
      expect(errorBody(gap).details?.[0]?.code).toBe('nonexistent_time');
    });

    it('marks a meeting done and still lets the notes be written afterwards', async () => {
      const m = await made(dan);
      expect(
        oneOnOneDetailSchema.parse((await patch(dan, m.id, { status: 'done' })).body).status,
      ).toBe('done');
      expect((await patch(mia, m.id, { sharedNotes: 'After the talk' })).status).toBe(200);
      expect((await item(mia, m.id)).status).toBe(201);
      expect(await changes(mia, m.id)).toHaveLength(1); // only the scheduling; "done" tells nobody
      expect(await changes(dan, m.id)).toEqual([]);
    });

    it('cancels, tells the other person, and then locks the meeting', async () => {
      const m = await made(dan);
      const i1 = goalItem((await item(dan, m.id)).body);
      expect((await patch(mia, m.id, { status: 'cancelled' })).status).toBe(200);
      expect(await changes(dan, m.id)).toEqual([
        { meetingId: m.id, date: soon, action: 'cancelled' },
      ]);
      const locked = [
        await patch(dan, m.id, { agenda: 'x' }),
        await patch(dan, m.id, { status: 'scheduled' }),
        await patch(dan, m.id, { privateNotes: 'x' }),
        await item(dan, m.id),
        await dan.agent.patch(`${api}/one-on-ones/${m.id}/action-items/${i1}`).send({ done: true }),
        await dan.agent.delete(`${api}/one-on-ones/${m.id}/action-items/${i1}`),
      ];
      for (const res of locked) {
        expect([res.status, errorBody(res).code, errorBody(res).params?.field]).toEqual([
          409,
          'CONFLICT',
          'status',
        ]);
      }
      const read = oneOnOneDetailSchema.parse((await open(dan, m.id)).body);
      expect(read).toMatchObject({ status: 'cancelled', canEdit: false });
    });

    it('lists upcoming first, then past, with paging and the open action items', async () => {
      const fresh = await onboard(acme, 'lister');
      await assign(fresh, mia.employeeId);
      const a = await made(fresh, { date: addDays(soon, 5) });
      const b = await made(fresh, { date: addDays(soon, 2) });
      const c = await made(fresh, { date: addDays(soon, 1) });
      await patch(fresh, c.id, { status: 'done' });
      await patch(fresh, a.id, { status: 'cancelled' });
      await item(fresh, b.id);
      const done = (await item(fresh, b.id, { title: 'Second' })).body.actionItems[1].id as string;
      await fresh.agent
        .patch(`${api}/one-on-ones/${b.id}/action-items/${done}`)
        .send({ done: true });
      expect(await ids(fresh, { status: 'upcoming' })).toEqual([b.id]);
      expect(await ids(fresh, { status: 'past' })).toEqual([a.id, c.id]); // newest first
      expect(await ids(fresh, { status: 'all' })).toEqual([a.id, b.id, c.id]);
      const page = await listOf(fresh, { status: 'all', pageSize: 2, page: 2 });
      expect([page.total, page.items.map((m) => m.id)]).toEqual([3, [c.id]]);
      expect((await listOf(fresh, { status: 'upcoming' })).items[0]!.openActionItems).toBe(1);
      const bad = await fresh.agent.get(`${api}/one-on-ones`).query({ status: 'x' });
      expect(bad.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('action items', () => {
    it('adds items for either person, completes, changes and removes them', async () => {
      const m = await made(dan);
      const due = addDays(today, 7);
      const added = oneOnOneDetailSchema.parse(
        (await item(dan, m.id, { title: ' Send notes ', dueDate: due })).body,
      );
      expect(added.actionItems).toEqual([
        {
          id: expect.any(String),
          title: 'Send notes',
          owner: expect.objectContaining({ id: dan.employeeId }),
          dueDate: due,
          done: false,
          overdue: false,
        },
      ]);
      const theirs = oneOnOneDetailSchema.parse(
        (await item(mia, m.id, { title: 'Book room', ownerEmployeeId: dan.employeeId })).body,
      );
      expect(theirs.actionItems[1]!.owner.id).toBe(dan.employeeId);
      const id = added.actionItems[0]!.id;
      const url = `${api}/one-on-ones/${m.id}/action-items/${id}`;
      const checked = oneOnOneDetailSchema.parse(
        (await mia.agent.patch(url).send({ done: true })).body,
      );
      expect(checked.actionItems[0]!.done).toBe(true);
      expect(checked.openActionItems).toBe(1);
      const row1 = await system.oneOnOneActionItem.findUniqueOrThrow({ where: { id } });
      expect(row1.doneAt).not.toBeNull();
      await mia.agent.patch(url).send({ done: true }); // again: the first time stays
      expect((await system.oneOnOneActionItem.findUniqueOrThrow({ where: { id } })).doneAt).toEqual(
        row1.doneAt,
      );
      const reopened = oneOnOneDetailSchema.parse(
        (
          await dan.agent
            .patch(url)
            .send({ done: false, title: 'Renamed', dueDate: null, ownerEmployeeId: mia.employeeId })
        ).body,
      );
      expect(reopened.actionItems[0]).toMatchObject({
        done: false,
        title: 'Renamed',
        dueDate: null,
        owner: { id: mia.employeeId },
      });
      const removed = oneOnOneDetailSchema.parse((await dan.agent.delete(url)).body);
      expect(removed.actionItems.map((i) => i.title)).toEqual(['Book room']);
    });

    it('flags an item as overdue only while it is open', async () => {
      const m = await made(dan);
      const yesterday = addDays(today, -1);
      const added = oneOnOneDetailSchema.parse(
        (await item(dan, m.id, { dueDate: yesterday })).body,
      );
      expect(added.actionItems[0]!.overdue).toBe(true);
      const url = `${api}/one-on-ones/${m.id}/action-items/${added.actionItems[0]!.id}`;
      const done = oneOnOneDetailSchema.parse(
        (await dan.agent.patch(url).send({ done: true })).body,
      );
      expect(done.actionItems[0]!.overdue).toBe(false);
    });

    it('gives items to the two people only', async () => {
      const m = await made(dan);
      for (const owner of [eve.employeeId, hr.employeeId, UNKNOWN]) {
        const res = await item(dan, m.id, { ownerEmployeeId: owner });
        expect([res.status, errorBody(res).details?.[0]?.code], owner).toEqual([
          400,
          'not_participant',
        ]);
      }
      const id = goalItem((await item(dan, m.id)).body);
      const res = await dan.agent
        .patch(`${api}/one-on-ones/${m.id}/action-items/${id}`)
        .send({ ownerEmployeeId: eve.employeeId });
      expect([res.status, errorBody(res).details?.[0]?.code]).toEqual([400, 'not_participant']);
    });

    it('holds at most 20 items per meeting', async () => {
      const m = await made(dan);
      for (let n = 0; n < 20; n += 1) {
        expect((await item(dan, m.id, { title: `Item ${n}` })).status).toBe(201);
      }
      const res = await item(dan, m.id);
      expect([res.status, errorBody(res).details?.[0]?.code]).toEqual([400, 'too_many']);
      // another meeting is not affected
      expect((await item(dan, (await made(dan)).id)).status).toBe(201);
    });

    it('never reaches an item through another meeting', async () => {
      const a = await made(dan);
      const b = await made(dan);
      const id = goalItem((await item(dan, a.id)).body);
      const url = `${api}/one-on-ones/${b.id}/action-items/${id}`;
      for (const res of [
        await dan.agent.patch(url).send({ done: true }),
        await dan.agent.delete(url),
      ]) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      const after = oneOnOneDetailSchema.parse((await open(dan, a.id)).body);
      expect(after.actionItems).toHaveLength(1);
      expect(after.actionItems[0]!.done).toBe(false);
      const unknown = await dan.agent.delete(`${api}/one-on-ones/${a.id}/action-items/${UNKNOWN}`);
      expect(unknown.status).toBe(404);
    });

    it.each([
      ['no title', { title: ' ' }],
      ['a long title', { title: 'x'.repeat(121) }],
      ['a bad date', { dueDate: '9.11.2026' }],
      ['a bad owner', { ownerEmployeeId: 'nope' }],
      ['unknown fields', { done: true }],
    ])('refuses %s', async (_label, body) => {
      const m = await made(dan);
      const res = await item(dan, m.id, body);
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('offboarding and reporting lines', () => {
    it('cancels the planned meetings of a leaver and keeps held ones', async () => {
      const boss = await onboard(acme, 'leavingboss', 'manager');
      const report = await onboard(acme, 'leavingreport');
      await assign(report, boss.employeeId);
      const planned = await made(report);
      const held = await made(report, { date: addDays(today, -3) });
      await patch(report, held.id, { status: 'done' });
      const res = await hr.agent
        .post(`${api}/employees/${boss.employeeId}/deactivate`)
        .send({ terminationDate: today });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const status = async (id: string) =>
        (await system.oneOnOne.findUniqueOrThrow({ where: { id } })).status;
      expect([await status(planned.id), await status(held.id)]).toEqual(['cancelled', 'done']);
    });

    it('cancels planned meetings with the old manager when the manager changes', async () => {
      const mover = await onboard(acme, 'mover');
      await assign(mover, mia.employeeId);
      const planned = await made(mover);
      const held = await made(mover, { date: addDays(today, -2) });
      await patch(mover, held.id, { status: 'done' });
      await assign(mover, ron.employeeId);
      const status = async (id: string) =>
        (await system.oneOnOne.findUniqueOrThrow({ where: { id } })).status;
      expect([await status(planned.id), await status(held.id)]).toEqual(['cancelled', 'done']);
      // the old manager keeps what they took part in, the new one sees nothing of it
      expect((await open(mia, held.id)).status).toBe(200);
      expect((await open(ron, held.id)).status).toBe(404);
      expect(await ids(ron)).toEqual([]);
      const fresh = await made(mover);
      expect(fresh.other.id).toBe(ron.employeeId);
    });

    it('leaves meetings alone when the same manager is assigned again', async () => {
      const same = await onboard(acme, 'steady');
      await assign(same, mia.employeeId);
      const planned = await made(same);
      await assign(same, mia.employeeId);
      expect((await system.oneOnOne.findUniqueOrThrow({ where: { id: planned.id } })).status).toBe(
        'scheduled',
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('privacy', () => {
    it('exports a person’s meetings with only their own private notes', async () => {
      const person = await onboard(acme, 'exporter');
      await assign(person, mia.employeeId);
      const m = await made(person, { agenda: 'Export agenda' });
      await patch(person, m.id, { sharedNotes: 'Shared words', privateNotes: 'Exporter private' });
      await patch(mia, m.id, { privateNotes: 'Manager private' });
      await item(person, m.id, { title: 'Do this', dueDate: addDays(today, 2) });
      const doc = personalDataExportSchema.parse(
        (await person.agent.get(`${api}/privacy/export`)).body,
      );
      expect(doc.oneOnOnes).toEqual([
        {
          scheduledAt: expect.any(String),
          status: 'scheduled',
          role: 'employee',
          agenda: 'Export agenda',
          sharedNotes: 'Shared words',
          privateNotes: 'Exporter private',
          actionItems: [{ title: 'Do this', dueDate: addDays(today, 2), done: false }],
        },
      ]);
      expect(JSON.stringify(doc)).not.toContain('Manager private');
      // HR exporting the person sees the same: the manager's private note is not theirs to read
      const byHr = await hr.agent.get(`${api}/privacy/export/${person.employeeId}`);
      expect(byHr.status).toBe(200);
      expect(JSON.stringify(byHr.body)).not.toContain('Manager private');
      const asManager = personalDataExportSchema.parse(
        (await mia.agent.get(`${api}/privacy/export`)).body,
      );
      const mine = asManager.oneOnOnes.find((x) => x.agenda === 'Export agenda');
      expect(mine).toMatchObject({ role: 'manager', privateNotes: 'Manager private' });
      expect(JSON.stringify(asManager.oneOnOnes)).not.toContain('Exporter private');
    });

    it('erases every meeting of a former employee, including the other person’s notes about them', async () => {
      const leaver = await onboard(acme, 'erasable');
      await assign(leaver, mia.employeeId);
      const m = await made(leaver, { agenda: 'Erase me' });
      await patch(mia, m.id, { privateNotes: 'Mia thinks about the leaver' });
      await item(leaver, m.id);
      const other = await made(dan);
      expect(
        (
          await hr.agent
            .post(`${api}/employees/${leaver.employeeId}/deactivate`)
            .send({ terminationDate: today })
        ).status,
      ).toBe(200);
      const erased = await hr.agent
        .post(`${api}/privacy/erase/${leaver.employeeId}`)
        .send({ confirm: true });
      expect(erased.status, JSON.stringify(erased.body)).toBeLessThan(300);
      expect(await system.oneOnOne.findUnique({ where: { id: m.id } })).toBeNull();
      expect(await system.oneOnOneActionItem.count({ where: { oneOnOneId: m.id } })).toBe(0);
      expect(await system.oneOnOne.findUnique({ where: { id: other.id } })).not.toBeNull();
      expect(await ids(mia)).not.toContain(m.id);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('tenant isolation and database rules', () => {
    it('keeps another workspace away from meetings, in lists and in every write', async () => {
      const m = await made(dan);
      const id = goalItem((await item(dan, m.id)).body);
      const x = globex.admin;
      expect(await ids(dan)).toContain(m.id);
      for (const res of [
        await open(x, m.id),
        await patch(x, m.id, { agenda: 'x' }),
        await item(x, m.id),
        await x.agent.patch(`${api}/one-on-ones/${m.id}/action-items/${id}`).send({ done: true }),
        await x.agent.delete(`${api}/one-on-ones/${m.id}/action-items/${id}`),
      ]) {
        expect([403, 404]).toContain(res.status);
      }
      const outsider = await onboard(globex, 'outsider');
      const boss = await onboard(globex, 'outboss', 'manager');
      await acme.admin.agent.get(`${api}/employees`); // keep acme warm
      await globex.admin.agent
        .put(`${api}/org/employees/${outsider.employeeId}/assignment`)
        .send({ managerId: boss.employeeId, departmentId: null });
      for (const res of [
        await open(outsider, m.id),
        await patch(outsider, m.id, { agenda: 'x' }),
        await item(outsider, m.id),
        await outsider.agent
          .patch(`${api}/one-on-ones/${m.id}/action-items/${id}`)
          .send({ done: true }),
        await outsider.agent.delete(`${api}/one-on-ones/${m.id}/action-items/${id}`),
      ]) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      expect(await ids(outsider)).toEqual([]);
      // a foreign employee id is "unknown", not a leak
      const probe = await create(boss, { employeeId: dan.employeeId });
      expect(errorBody(probe).details?.[0]?.code).toBe('unknown_employee');
      expect(await ids(dan)).toContain(m.id);
    });

    it('enforces the rules in the database when the application is bypassed', async () => {
      const base = {
        tenantId: acme.tenantId,
        managerEmployeeId: mia.employeeId,
        employeeId: dan.employeeId,
        scheduledAt: new Date('2027-01-01T08:00:00Z'),
      };
      const refuse = (data: object) =>
        expect(system.oneOnOne.create({ data: { ...base, ...data } as never })).rejects.toThrow();
      await refuse({ managerEmployeeId: dan.employeeId }); // meeting with oneself
      await refuse({ status: 'later' });
      await refuse({ durationMinutes: 14 });
      await refuse({ durationMinutes: 241 });
      await refuse({ agenda: 'x'.repeat(1001) });
      await refuse({ sharedNotes: 'x'.repeat(2001) });
      await refuse({ privateNotesManager: 'x'.repeat(2001) });
      await refuse({ privateNotesEmployee: 'x'.repeat(2001) });
      const row = await system.oneOnOne.create({ data: base });
      const part = { tenantId: acme.tenantId, oneOnOneId: row.id };
      await expect(
        system.oneOnOneActionItem.create({
          data: { ...part, ownerEmployeeId: eve.employeeId, title: 'x' },
        }),
      ).rejects.toThrow(); // not a participant
      await expect(
        system.oneOnOneActionItem.create({
          data: { ...part, ownerEmployeeId: dan.employeeId, title: '' },
        }),
      ).rejects.toThrow();
      await expect(
        system.oneOnOneActionItem.create({
          data: { ...part, ownerEmployeeId: dan.employeeId, title: 'x'.repeat(121) },
        }),
      ).rejects.toThrow();
      const ok = await system.oneOnOneActionItem.create({
        data: { ...part, ownerEmployeeId: dan.employeeId, title: 'Fine' },
      });
      await expect(
        system.oneOnOneActionItem.update({
          where: { id: ok.id },
          data: { ownerEmployeeId: eve.employeeId },
        }),
      ).rejects.toThrow();
      expect(
        (
          await system.oneOnOneActionItem.update({
            where: { id: ok.id },
            data: { ownerEmployeeId: mia.employeeId },
          })
        ).ownerEmployeeId,
      ).toBe(mia.employeeId);
    });
  });
});

/** The id of the last action item in a meeting response. */
function goalItem(body: unknown): string {
  const items = oneOnOneDetailSchema.parse(body).actionItems;
  return items[items.length - 1]!.id;
}
