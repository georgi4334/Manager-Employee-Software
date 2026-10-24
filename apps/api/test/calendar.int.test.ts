import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  calendarEventListSchema,
  calendarEventSchema,
  employeeSchema,
  todayIn,
  zonedToUtc,
  type SystemRole,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { TenantContext, type TenantTx } from '../src/infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../src/infrastructure/tenancy/tenant-db.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;
const UNKNOWN = '0192f5a0-0000-7000-8000-00000000000a';
const ZONE = 'Europe/Sofia';

describe.skipIf(!urls)('calendar over HTTP (real database)', () => {
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
  let mia: Person; // manager, leads team A
  let dan: Person; // member of team A
  let eve: Person; // member of team A
  let gus: Person; // in no team
  let zed: Person; // member of team B
  let teamA: string;
  let teamB: string;

  const today = todayIn(ZONE);
  const asTenant = <T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>) =>
    app.get(TenantContext).run(tenantId, () => app.get(TenantDb).tx(fn));

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

  const create = (who: Member, body: object) =>
    who.agent.post('/api/v1/calendar/events').send(body);
  const patch = (who: Member, id: string, body: object) =>
    who.agent.patch(`/api/v1/calendar/events/${id}`).send(body);
  const remove = (who: Member, id: string) => who.agent.delete(`/api/v1/calendar/events/${id}`);
  const list = async (who: Member, from: string, to: string) => {
    const res = await who.agent.get('/api/v1/calendar/events').query({ from, to });
    expect(res.status).toBe(200);
    return calendarEventListSchema.parse(res.body).items;
  };
  const timed = (extra: object = {}) => ({
    scope: 'personal',
    title: 'Dentist',
    allDay: false,
    startDate: addDays(today, 3),
    endDate: addDays(today, 3),
    startTime: '09:00',
    endTime: '10:30',
    ...extra,
  });
  const allDay = (extra: object = {}) => ({
    scope: 'personal',
    title: 'Conference',
    allDay: true,
    startDate: addDays(today, 10),
    endDate: addDays(today, 12),
    ...extra,
  });
  const ids = async (who: Member) =>
    (await list(who, addDays(today, -30), addDays(today, 60))).map((e) => e.id);
  const made = async (who: Member, body: object) => {
    const res = await create(who, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return calendarEventSchema.parse(res.body);
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
    eve = await onboard(acme, 'eve');
    gus = await onboard(acme, 'gus');
    zed = await onboard(acme, 'zed');
    const department = (await hr.agent.post('/api/v1/org/departments').send({ name: 'Eng' })).body
      .id;
    teamA = (
      await hr.agent
        .post('/api/v1/org/teams')
        .send({ name: 'A', departmentId: department, leadEmployeeId: mia.employeeId })
    ).body.id;
    teamB = (await hr.agent.post('/api/v1/org/teams').send({ name: 'B', departmentId: department }))
      .body.id;
    for (const [team, members] of [
      [teamA, [dan, eve]],
      [teamB, [zed]],
    ] as const) {
      const res = await hr.agent
        .put(`/api/v1/org/teams/${team}/members`)
        .send({ employeeIds: members.map((m) => m.employeeId) });
      expect(res.status).toBe(200);
    }
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe('personal events', () => {
    it('creates a timed event in the workspace time zone and gives it back as local fields', async () => {
      const event = await made(dan, timed());
      expect(event).toMatchObject({
        scope: 'personal',
        team: null,
        title: 'Dentist',
        description: null,
        location: null,
        allDay: false,
        startDate: addDays(today, 3),
        endDate: addDays(today, 3),
        startTime: '09:00',
        endTime: '10:30',
        canEdit: true,
        owner: { id: dan.employeeId, firstName: 'dan' },
      });
      const row = await system.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(row.startsAt?.toISOString()).toBe(
        zonedToUtc(addDays(today, 3), '09:00', ZONE)!.toISOString(),
      );
      expect(row.endsAt?.toISOString()).toBe(
        zonedToUtc(addDays(today, 3), '10:30', ZONE)!.toISOString(),
      );
    });

    it('creates all-day and multi-day events with text fields trimmed', async () => {
      const event = await made(
        dan,
        allDay({ title: '  Conference ', description: ' Hall 4 ', location: '  ' }),
      );
      expect(event).toMatchObject({
        title: 'Conference',
        description: 'Hall 4',
        location: null,
        allDay: true,
        startTime: null,
        endTime: null,
        startDate: addDays(today, 10),
        endDate: addDays(today, 12),
      });
      const row = await system.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect([row.startsAt, row.endsAt]).toEqual([null, null]);
      const overnight = await made(
        dan,
        timed({ endDate: addDays(today, 4), endTime: '08:00', title: 'Night trip' }),
      );
      expect([overnight.startDate, overnight.endDate]).toEqual([
        addDays(today, 3),
        addDays(today, 4),
      ]);
    });

    it('is seen only by its owner, in lists and by id', async () => {
      const event = await made(dan, timed({ title: 'Private' }));
      expect(await ids(dan)).toContain(event.id);
      for (const other of [eve, mia, hr, gus, acme.admin]) {
        expect(await ids(other)).not.toContain(event.id);
        for (const res of [
          await patch(other, event.id, { title: 'x' }),
          await remove(other, event.id),
        ]) {
          expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
        }
      }
      expect(
        (await system.calendarEvent.findUniqueOrThrow({ where: { id: event.id } })).title,
      ).toBe('Private');
    });

    it('lists the events that overlap the period, with exact boundaries', async () => {
      const person = await onboard(acme, 'range');
      const base = addDays(today, 40);
      const event = await made(
        person,
        allDay({ startDate: addDays(base, 1), endDate: addDays(base, 3) }),
      );
      const has = async (from: string, to: string) =>
        (await list(person, from, to)).some((e) => e.id === event.id);
      expect(await has(base, base)).toBe(false); // the day before
      expect(await has(base, addDays(base, 1))).toBe(true); // touches the first day
      expect(await has(addDays(base, 2), addDays(base, 2))).toBe(true); // inside
      expect(await has(addDays(base, 3), addDays(base, 9))).toBe(true); // touches the last day
      expect(await has(addDays(base, 4), addDays(base, 9))).toBe(false); // the day after
    });

    it('orders by start and refuses periods that are invalid or too long', async () => {
      const person = await onboard(acme, 'order');
      const d = addDays(today, 50);
      const late = await made(
        person,
        timed({ startDate: d, endDate: d, startTime: '15:00', endTime: '16:00' }),
      );
      const early = await made(
        person,
        timed({ startDate: d, endDate: d, startTime: '08:00', endTime: '09:00' }),
      );
      expect((await list(person, d, d)).map((e) => e.id)).toEqual([early.id, late.id]);
      for (const query of [
        { from: d, to: addDays(d, -1) },
        { from: d, to: addDays(d, 93) },
        { from: d },
        { from: 'x', to: d },
      ]) {
        const res = await person.agent.get('/api/v1/calendar/events').query(query);
        expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
      }
    });

    it.each([
      ['no title', { title: ' ' }],
      ['a long title', { title: 'x'.repeat(121) }],
      ['a long description', { description: 'x'.repeat(1001) }],
      ['an unknown scope', { scope: 'public' }],
      ['an end before the start', { startTime: '10:00', endTime: '09:00' }],
      ['an end date before the start date', { endDate: addDays(today, 2) }],
      ['a bad time', { startTime: '9am' }],
      ['no times on a timed event', { startTime: undefined, endTime: undefined }],
      ['times on an all-day event', { allDay: true }],
      ['more than 31 days', allDay({ endDate: addDays(today, 50) })],
      ['a team on a personal event', { teamId: UNKNOWN }],
      ['a team event without a team', { scope: 'team' }],
      ['a forged owner', { ownerEmployeeId: UNKNOWN }],
    ])('rejects %s', async (_label, patchBody) => {
      const res = await create(dan, { ...timed(), ...patchBody });
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('refuses a time that does not exist when the clocks go forward', async () => {
      const res = await create(
        dan,
        timed({
          startDate: '2027-03-28',
          endDate: '2027-03-28',
          startTime: '03:30',
          endTime: '05:00',
        }),
      );
      expect([res.status, errorBody(res).details?.[0]?.code]).toEqual([400, 'nonexistent_time']);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('changing and deleting', () => {
    it('changes some fields, clears text and keeps the rest', async () => {
      const event = await made(dan, timed({ description: 'Bring papers', location: 'Clinic' }));
      const res = await patch(dan, event.id, {
        title: 'Dentist (moved)',
        endTime: '11:00',
        description: ' ',
      });
      expect(res.status).toBe(200);
      expect(calendarEventSchema.parse(res.body)).toMatchObject({
        title: 'Dentist (moved)',
        startTime: '09:00',
        endTime: '11:00',
        description: null,
        location: 'Clinic',
      });
    });

    it('switches between all-day and timed, and refuses an event that would be half-specified', async () => {
      const event = await made(dan, timed());
      const toAllDay = await patch(dan, event.id, { allDay: true });
      expect(calendarEventSchema.parse(toAllDay.body)).toMatchObject({
        allDay: true,
        startTime: null,
        endTime: null,
      });
      const row = await system.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect([row.startsAt, row.endsAt]).toEqual([null, null]);
      const noTimes = await patch(dan, event.id, { allDay: false });
      expect([noTimes.status, errorBody(noTimes).code]).toEqual([400, 'VALIDATION_FAILED']);
      const back = await patch(dan, event.id, {
        allDay: false,
        startTime: '13:00',
        endTime: '14:00',
      });
      expect(calendarEventSchema.parse(back.body)).toMatchObject({
        startTime: '13:00',
        endTime: '14:00',
      });
    });

    it.each([
      ['an empty change', {}],
      ['a new scope', { scope: 'company' }],
      ['a new team', { teamId: UNKNOWN }],
      ['an end before the start', { endTime: '08:00' }],
      ['an end date before the start date', { endDate: addDays(today, 1) }],
      ['a long title', { title: 'x'.repeat(121) }],
      ['a time on an all-day change', { allDay: true, startTime: '09:00' }],
    ])('rejects %s on update', async (_label, body) => {
      const event = await made(dan, timed());
      const res = await patch(dan, event.id, body);
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
      expect(calendarEventSchema.parse(await readOne(dan, event.id))).toMatchObject({
        title: 'Dentist',
        endTime: '10:30',
      });
    });

    it('deletes, and a second delete or change finds nothing; bad ids are refused', async () => {
      const event = await made(dan, timed());
      expect((await remove(dan, event.id)).status).toBe(204);
      expect((await remove(dan, event.id)).status).toBe(404);
      expect((await patch(dan, event.id, { title: 'x' })).status).toBe(404);
      expect((await patch(dan, UNKNOWN, { title: 'x' })).status).toBe(404);
      expect((await dan.agent.delete('/api/v1/calendar/events/nope')).status).toBe(400);
    });

    async function readOne(who: Member, id: string) {
      const found = (await list(who, addDays(today, -30), addDays(today, 60))).find(
        (e) => e.id === id,
      );
      return found;
    }
  });

  // ---------------------------------------------------------------------------------------------
  describe('team events', () => {
    it('are seen by the members and the lead of the team, and by nobody else without scope all', async () => {
      const event = await made(mia, timed({ scope: 'team', teamId: teamA, title: 'Planning' }));
      expect(event.team).toEqual({ id: teamA, name: 'A' });
      for (const who of [mia, dan, eve, hr, acme.admin]) expect(await ids(who)).toContain(event.id);
      for (const who of [gus, zed]) {
        expect(await ids(who)).not.toContain(event.id);
        const res = await patch(who, event.id, { title: 'x' });
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
    });

    it('can be changed by the lead and by scope all, not by plain members (who see canEdit false)', async () => {
      const event = await made(mia, timed({ scope: 'team', teamId: teamA }));
      const seenByDan = (await list(dan, addDays(today, 3), addDays(today, 3))).find(
        (e) => e.id === event.id,
      );
      expect(seenByDan?.canEdit).toBe(false);
      for (const res of [await patch(dan, event.id, { title: 'x' }), await remove(dan, event.id)]) {
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      }
      expect((await patch(hr, event.id, { title: 'By HR' })).status).toBe(200);
      expect((await patch(mia, event.id, { title: 'By lead' })).status).toBe(200);
      expect((await remove(mia, event.id)).status).toBe(204);
    });

    it('can be created only for teams the person leads or belongs to, or with scope all', async () => {
      const own = await create(dan, timed({ scope: 'team', teamId: teamA }));
      expect([own.status, errorBody(own).code]).toEqual([403, 'FORBIDDEN']); // employees hold no team permission
      const foreign = await create(mia, timed({ scope: 'team', teamId: teamB }));
      expect([foreign.status, errorBody(foreign).code]).toEqual([403, 'FORBIDDEN']);
      expect((await create(hr, timed({ scope: 'team', teamId: teamB }))).status).toBe(201);
      const missing = await create(hr, timed({ scope: 'team', teamId: UNKNOWN }));
      expect([missing.status, errorBody(missing).code]).toEqual([404, 'NOT_FOUND']);
    });

    it('are audited without their content, personal ones are not', async () => {
      const before = await system.auditLog.count({ where: { tenantId: acme.tenantId } });
      const secret = 'Layoff planning';
      const event = await made(mia, timed({ scope: 'team', teamId: teamA, title: secret }));
      await patch(mia, event.id, { title: secret + ' v2' });
      await remove(mia, event.id);
      await made(dan, timed({ title: secret }));
      const logs = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, entity: 'calendar_event' },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.slice(-3).map((l) => l.action)).toEqual([
        'calendar.event_created',
        'calendar.event_updated',
        'calendar.event_deleted',
      ]);
      expect(JSON.stringify(logs)).not.toContain('Layoff');
      expect(await system.auditLog.count({ where: { tenantId: acme.tenantId } })).toBe(before + 3);
    });

    it('disappear with their team', async () => {
      const department = (await hr.agent.post('/api/v1/org/departments').send({ name: 'Temp' }))
        .body.id;
      const team = (
        await hr.agent.post('/api/v1/org/teams').send({ name: 'Temp', departmentId: department })
      ).body.id;
      const event = await made(hr, timed({ scope: 'team', teamId: team }));
      expect((await hr.agent.delete(`/api/v1/org/teams/${team}`)).status).toBe(204);
      expect(await system.calendarEvent.findUnique({ where: { id: event.id } })).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('company events', () => {
    it('are seen by everybody and changed only by HR and Admin', async () => {
      const event = await made(hr, allDay({ scope: 'company', title: 'Summer party' }));
      for (const who of [hr, mia, dan, gus, zed, acme.admin]) {
        const seen = (await list(who, addDays(today, 10), addDays(today, 12))).find(
          (e) => e.id === event.id,
        );
        expect(seen, 'visible').toBeDefined();
        expect(seen?.canEdit).toBe(who === hr || who === acme.admin);
      }
      for (const who of [dan, mia, gus]) {
        for (const res of [
          await patch(who, event.id, { title: 'x' }),
          await remove(who, event.id),
          await create(who, allDay({ scope: 'company' })),
        ]) {
          expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
        }
      }
      expect((await patch(acme.admin, event.id, { title: 'Party!' })).status).toBe(200);
      expect((await remove(hr, event.id)).status).toBe(204);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('tenant isolation and database rules', () => {
    it('keeps another workspace away from events, in lists and in every write', async () => {
      const event = await made(hr, allDay({ scope: 'company', title: 'Internal' }));
      const g = globex.admin;
      expect(await ids(g)).not.toContain(event.id);
      for (const res of [await patch(g, event.id, { title: 'x' }), await remove(g, event.id)]) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.calendarEvent.findUnique({ where: { id: event.id } }),
        ),
      ).toBeNull();
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.calendarEvent.deleteMany({ where: { id: event.id } }),
        ),
      ).toEqual({ count: 0 });
      const foreign = await system.employee.findFirstOrThrow({
        where: { tenantId: globex.tenantId },
      });
      const data = {
        scope: 'company',
        title: 'x',
        allDay: true,
        startDate: new Date(),
        endDate: new Date(),
      };
      await expect(
        asTenant(globex.tenantId, (tx) =>
          tx.calendarEvent.create({
            data: { ...data, tenantId: acme.tenantId, ownerEmployeeId: dan.employeeId },
          }),
        ),
      ).rejects.toThrow();
      await expect(
        system.calendarEvent.create({
          data: { ...data, tenantId: acme.tenantId, ownerEmployeeId: foreign.id },
        }),
      ).rejects.toThrow(); // an owner of another workspace
      await expect(
        system.calendarEvent.create({
          data: {
            ...data,
            scope: 'team',
            tenantId: acme.tenantId,
            ownerEmployeeId: dan.employeeId,
            teamId: UNKNOWN,
          },
        }),
      ).rejects.toThrow();
    });

    it('enforces the shape rules when the application is bypassed', async () => {
      const day = (offset: number) => new Date(`${addDays(today, offset)}T00:00:00Z`);
      const base = {
        tenantId: acme.tenantId,
        ownerEmployeeId: dan.employeeId,
        scope: 'personal',
        title: 'Rules',
        allDay: true,
        startDate: day(1),
        endDate: day(1),
      };
      const at = new Date('2027-05-05T07:00:00Z');
      const later = new Date('2027-05-05T08:00:00Z');
      const refuse = (data: object) =>
        expect(system.calendarEvent.create({ data: { ...base, ...data } })).rejects.toThrow();
      await refuse({ scope: 'party' });
      await refuse({ scope: 'team' }); // a team event without a team
      await refuse({ teamId: teamA }); // a team on a personal event
      await refuse({ title: '' });
      await refuse({ title: 'x'.repeat(121) });
      await refuse({ endDate: day(0) });
      await refuse({ endDate: day(32) }); // 32 days
      await refuse({ startsAt: at, endsAt: later }); // instants on an all-day event
      await refuse({ allDay: false }); // a timed event without instants
      await refuse({ allDay: false, startsAt: later, endsAt: at });
      await refuse({ allDay: false, startsAt: at, endsAt: at });
      await system.calendarEvent.create({ data: { ...base, endDate: day(31) } }); // exactly 32 calendar days minus one: allowed
      await system.calendarEvent.create({
        data: { ...base, allDay: false, startsAt: at, endsAt: later },
      });
    });
  });
});
