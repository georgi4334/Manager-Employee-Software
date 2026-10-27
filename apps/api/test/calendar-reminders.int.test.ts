import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  calendarEventSchema,
  employeeSchema,
  type CalendarEvent,
  type SystemRole,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { RemindersService } from '../src/modules/notifications/delivery/reminders.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;
const api = '/api/v1';
const ZONE = 'Europe/Sofia';
/** Far from today and before the 2031 clock change (Sofia is UTC+2 in March until the 30th). */
const MON = '2031-03-10';
const at = (iso: string) => new Date(iso);

describe.skipIf(!urls)('event reminders over HTTP (real database)', () => {
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
  let mia: Person; // leads the team "Crew"
  let dan: Person; // in the team
  let eve: Person; // not in the team
  let sam: Person;
  let teamId: string;
  const reminders = () => app.get(RemindersService);

  async function onboard(ws: Workspace, name: string, role: SystemRole = 'employee') {
    const email = `${name}@${ws === acme ? 'acme' : 'globex'}.eu`;
    const res = await ws.admin.agent
      .post(`${api}/employees`)
      .send({ firstName: name, lastName: 'Test', employmentType: 'full_time', email });
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

  const timed = (title: string, date: string, start: string, end: string, extra: object = {}) => ({
    scope: 'personal',
    title,
    allDay: false,
    startDate: date,
    endDate: date,
    startTime: start,
    endTime: end,
    ...extra,
  });
  const post = (as: Member, body: object) => as.agent.post(`${api}/calendar/events`).send(body);
  const make = async (as: Member, body: object): Promise<CalendarEvent> => {
    const res = await post(as, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return calendarEventSchema.parse(res.body);
  };
  const patch = (as: Member, id: string, body: object, query: object = {}) =>
    as.agent.patch(`${api}/calendar/events/${id}`).query(query).send(body);
  const del = (as: Member, id: string, query: object = {}) =>
    as.agent.delete(`${api}/calendar/events/${id}`).query(query);

  /** Runs the sweep at an instant and returns who was told about which event and date. */
  const sweep = async (now: Date, tenantId = acme.tenantId) => {
    const before = await system.outboxEvent.count({
      where: { tenantId, type: 'calendar.reminder' },
    });
    const stats = await reminders().run(now);
    const rows = await system.outboxEvent.findMany({
      where: { tenantId, type: 'calendar.reminder' },
      orderBy: { createdAt: 'asc' },
    });
    const fresh = rows.slice(before).map((r) => r.params as Record<string, string>);
    return { stats, fresh };
  };
  const told = (fresh: Record<string, string>[], eventId: string) =>
    fresh
      .filter((p) => p.eventId === eventId)
      .map((p) => p.recipientUserId)
      .sort();

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    for (const ws of [acme, globex]) {
      await system.tenant.update({ where: { id: ws.tenantId }, data: { defaultTimezone: ZONE } });
    }
    hr = await onboard(acme, 'hrx', 'hr');
    mia = await onboard(acme, 'mia', 'manager');
    dan = await onboard(acme, 'dan');
    eve = await onboard(acme, 'eve');
    sam = await onboard(acme, 'sam');
    const dep = await acme.admin.agent.post(`${api}/org/departments`).send({ name: 'Eng' });
    const team = await acme.admin.agent.post(`${api}/org/teams`).send({
      name: 'Crew',
      departmentId: (dep.body as { id: string }).id,
      leadEmployeeId: mia.employeeId,
    });
    teamId = (team.body as { id: string }).id;
    const add = await acme.admin.agent
      .put(`${api}/org/teams/${teamId}/members`)
      .send({ employeeIds: [dan.employeeId] });
    expect(add.status, JSON.stringify(add.body)).toBeLessThan(300);
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  describe('setting the reminder', () => {
    it('stores it, returns it and removes it with null', async () => {
      const e = await make(dan, timed('Dentist', MON, '10:00', '11:00', { reminderMinutes: 60 }));
      expect(e.reminderMinutes).toBe(60);
      const changed = await patch(dan, e.id, { reminderMinutes: 1440 });
      expect(calendarEventSchema.parse(changed.body).reminderMinutes).toBe(1440);
      const cleared = await patch(dan, e.id, { reminderMinutes: null });
      expect(calendarEventSchema.parse(cleared.body).reminderMinutes).toBeNull();
      expect((await make(dan, timed('Plain', MON, '12:00', '13:00'))).reminderMinutes).toBeNull();
    });

    it.each([0, 15, 61, 120, '60', -60])('refuses %s minutes', async (reminderMinutes) => {
      const res = await post(dan, timed('Bad', MON, '10:00', '11:00', { reminderMinutes }));
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
      const e = await make(dan, timed('Ok', MON, '10:00', '11:00'));
      expect((await patch(dan, e.id, { reminderMinutes })).status).toBe(400);
    });

    it('refuses a reminder on a company event, on create and on update', async () => {
      const create = await post(hr, {
        scope: 'company',
        title: 'Party',
        allDay: true,
        startDate: MON,
        endDate: MON,
        reminderMinutes: 60,
      });
      expect(create.status).toBe(400);
      const e = await make(hr, {
        scope: 'company',
        title: 'Party',
        allDay: true,
        startDate: MON,
        endDate: MON,
      });
      const res = await patch(hr, e.id, { reminderMinutes: 60 });
      expect(res.status).toBe(400);
      expect(errorBody(res).details?.[0]?.code).toBe('reminder_not_allowed');
    });

    it('is checked by the database too', async () => {
      const base = {
        tenantId: acme.tenantId,
        ownerEmployeeId: dan.employeeId,
        title: 'x',
        allDay: true,
        startDate: new Date(`${MON}T00:00:00Z`),
        endDate: new Date(`${MON}T00:00:00Z`),
      };
      for (const data of [
        { scope: 'personal', reminderMinutes: 30 },
        { scope: 'company', reminderMinutes: 60 },
      ]) {
        await expect(system.calendarEvent.create({ data: { ...base, ...data } })).rejects.toThrow();
      }
      await expect(
        system.calendarEvent.create({
          data: { ...base, scope: 'personal', reminderMinutes: 1440 },
        }),
      ).resolves.toBeTruthy();
    });

    it('lets only people who may change the event set it', async () => {
      const e = await make(dan, timed('Mine', MON, '10:00', '11:00'));
      expect((await patch(eve, e.id, { reminderMinutes: 60 })).status).toBe(404);
      expect((await patch(sam, e.id, { reminderMinutes: 60 })).status).toBe(404);
    });
  });

  describe('the sweep', () => {
    it('reminds the owner once, from one hour before until the start', async () => {
      const e = await make(dan, timed('Dentist', MON, '10:00', '11:00', { reminderMinutes: 60 }));
      // 10:00 in Sofia is 08:00 UTC
      expect((await sweep(at(`${MON}T06:59:00Z`))).fresh).toEqual([]);
      const first = await sweep(at(`${MON}T07:00:00Z`));
      expect(first.fresh).toEqual([{ recipientUserId: dan.id, eventId: e.id, date: MON }]);
      expect(first.stats.events).toBeGreaterThanOrEqual(1);
      // a second run, a later run and a run at the start send nothing more
      expect((await sweep(at(`${MON}T07:30:00Z`))).fresh).toEqual([]);
      expect((await sweep(at(`${MON}T07:59:00Z`))).fresh).toEqual([]);
    });

    it('does not send a stale reminder once the event has started', async () => {
      const e = await make(
        dan,
        timed('Missed', '2031-03-11', '10:00', '11:00', { reminderMinutes: 60 }),
      );
      const late = await sweep(at('2031-03-11T08:00:00Z'));
      expect(told(late.fresh, e.id)).toEqual([]);
      expect(await system.calendarReminder.count({ where: { eventId: e.id } })).toBe(0);
    });

    it('sends nothing for events without a reminder', async () => {
      const e = await make(dan, timed('Quiet', '2031-03-12', '10:00', '11:00'));
      const run = await sweep(at('2031-03-12T07:30:00Z'));
      expect(told(run.fresh, e.id)).toEqual([]);
    });

    it('tells the organizer and guests who have not declined, nobody else', async () => {
      const e = await make(
        dan,
        timed('Lunch', '2031-03-13', '12:00', '13:00', {
          reminderMinutes: 60,
          attendeeIds: [eve.employeeId, sam.employeeId],
        }),
      );
      const ev = await eve.agent
        .get(`${api}/calendar/events`)
        .query({ from: '2031-03-13', to: '2031-03-13' });
      expect(ev.status).toBe(200);
      const sams = await sam.agent
        .put(`${api}/calendar/events/${e.id}/response`)
        .send({ response: 'declined' });
      expect(sams.status).toBe(200);
      const run = await sweep(at('2031-03-13T09:30:00Z'));
      expect(told(run.fresh, e.id)).toEqual([dan.id, eve.id].sort());
      expect(told(run.fresh, e.id)).not.toContain(sam.id);
      expect(told(run.fresh, e.id)).not.toContain(mia.id);
    });

    it('reminds the lead and the members of a team event, not other people', async () => {
      const e = await make(mia, {
        scope: 'team',
        teamId,
        title: 'Crew sync',
        allDay: false,
        startDate: '2031-03-14',
        endDate: '2031-03-14',
        startTime: '10:00',
        endTime: '10:30',
        reminderMinutes: 60,
      });
      const run = await sweep(at('2031-03-14T07:15:00Z'));
      expect(told(run.fresh, e.id)).toEqual([mia.id, dan.id].sort());
    });

    it('treats an all-day event as starting at midnight of its first day', async () => {
      const e = await make(dan, {
        scope: 'personal',
        title: 'Trip',
        allDay: true,
        startDate: '2031-03-18',
        endDate: '2031-03-19',
        reminderMinutes: 1440,
      });
      // midnight in Sofia on the 18th is 22:00 UTC on the 17th
      expect(told((await sweep(at('2031-03-16T21:59:00Z'))).fresh, e.id)).toEqual([]);
      expect((await sweep(at('2031-03-16T22:00:00Z'))).fresh).toContainEqual({
        recipientUserId: dan.id,
        eventId: e.id,
        date: '2031-03-18',
      });
    });

    describe('series', () => {
      it('reminds each occurrence once, skips cancelled ones and stays inside the lead', async () => {
        const s = await make(
          dan,
          timed('Weekly', '2031-04-07', '09:00', '09:30', {
            reminderMinutes: 1440,
            recurrence: { freq: 'weekly', count: 4 },
          }),
        );
        // the clocks went forward on 30 March: 09:00 in Sofia is 06:00 UTC
        expect((await del(dan, s.id, { mode: 'this', occurrence: '2031-04-21' })).status).toBe(204);
        const dates: string[] = [];
        for (const now of [
          '2031-04-06T12:00:00Z',
          '2031-04-13T12:00:00Z',
          '2031-04-13T13:00:00Z',
          '2031-04-20T12:00:00Z',
          '2031-04-27T12:00:00Z',
        ]) {
          const run = await sweep(at(now));
          dates.push(...run.fresh.flatMap((p) => (p.eventId === s.id && p.date ? [p.date] : [])));
        }
        expect(dates).toEqual(['2031-04-07', '2031-04-14', '2031-04-28']);
      });

      it('lets a changed occurrence keep its reminder as a one-off event', async () => {
        const s = await make(
          dan,
          timed('Rolling', '2031-05-05', '09:00', '09:30', {
            reminderMinutes: 60,
            recurrence: { freq: 'weekly', count: 3 },
          }),
        );
        const res = await patch(
          dan,
          s.id,
          { title: 'Moved', startTime: '11:00', endTime: '11:30' },
          { mode: 'this', occurrence: '2031-05-12' },
        );
        const copy = calendarEventSchema.parse(res.body);
        expect(copy.reminderMinutes).toBe(60);
        const run = await sweep(at('2031-05-12T07:00:00Z')); // 10:00 Sofia, 11:00 start
        expect(told(run.fresh, copy.id)).toEqual([dan.id]);
        expect(told(run.fresh, s.id)).toEqual([]);
      });
    });

    it('reminds again when the time or the lead changes', async () => {
      const e = await make(
        dan,
        timed('Shift', '2031-03-20', '10:00', '11:00', { reminderMinutes: 60 }),
      );
      expect(told((await sweep(at('2031-03-20T07:10:00Z'))).fresh, e.id)).toEqual([dan.id]);
      expect(told((await sweep(at('2031-03-20T07:20:00Z'))).fresh, e.id)).toEqual([]);
      expect((await patch(dan, e.id, { startTime: '14:00', endTime: '15:00' })).status).toBe(200);
      expect(await system.calendarReminder.count({ where: { eventId: e.id } })).toBe(0);
      expect(told((await sweep(at('2031-03-20T11:30:00Z'))).fresh, e.id)).toEqual([dan.id]);
      // a new lead is a new reminder too
      expect((await patch(dan, e.id, { reminderMinutes: 1440 })).status).toBe(200);
      expect(told((await sweep(at('2031-03-20T11:45:00Z'))).fresh, e.id)).toEqual([dan.id]);
    });

    it('does not remind for a deleted event and removes its claims with it', async () => {
      const e = await make(
        dan,
        timed('Gone', '2031-03-21', '10:00', '11:00', { reminderMinutes: 60 }),
      );
      await sweep(at('2031-03-21T07:30:00Z'));
      expect(await system.calendarReminder.count({ where: { eventId: e.id } })).toBe(1);
      expect((await del(dan, e.id)).status).toBe(204);
      expect(await system.calendarReminder.count({ where: { eventId: e.id } })).toBe(0);
    });

    it('does not tell people without an active account, but still claims the occurrence', async () => {
      const e = await make(
        sam,
        timed('Solo', '2031-03-24', '10:00', '11:00', { reminderMinutes: 60 }),
      );
      await system.employee.update({ where: { id: sam.employeeId }, data: { status: 'inactive' } });
      const run = await sweep(at('2031-03-24T07:30:00Z'));
      expect(told(run.fresh, e.id)).toEqual([]);
      expect(await system.calendarReminder.count({ where: { eventId: e.id } })).toBe(1);
      await system.employee.update({ where: { id: sam.employeeId }, data: { status: 'active' } });
    });

    it('does not let two runs at the same time both send', async () => {
      const e = await make(
        dan,
        timed('Race', '2031-03-25', '10:00', '11:00', { reminderMinutes: 60 }),
      );
      const now = at('2031-03-25T07:30:00Z');
      await Promise.all([reminders().run(now), reminders().run(now)]);
      const sent = await system.outboxEvent.findMany({
        where: { tenantId: acme.tenantId, type: 'calendar.reminder' },
      });
      expect(sent.filter((r) => (r.params as { eventId: string }).eventId === e.id)).toHaveLength(
        1,
      );
    });

    it('carries ids and the date only, never the title', async () => {
      const e = await make(
        dan,
        timed('Secret title', '2031-03-26', '10:00', '11:00', { reminderMinutes: 60 }),
      );
      await sweep(at('2031-03-26T07:30:00Z'));
      const rows = await system.outboxEvent.findMany({
        where: { tenantId: acme.tenantId, type: 'calendar.reminder' },
      });
      const row = rows.find((r) => (r.params as { eventId: string }).eventId === e.id)!;
      expect(Object.keys(row.params as object).sort()).toEqual([
        'date',
        'eventId',
        'recipientUserId',
      ]);
      expect(JSON.stringify(rows)).not.toContain('Secret title');
    });
  });

  describe('workspaces', () => {
    it('keeps reminders and claims inside their own workspace', async () => {
      const gdan = await onboard(globex, 'gdan');
      const mine = await make(
        gdan,
        timed('Theirs', '2031-03-27', '10:00', '11:00', { reminderMinutes: 60 }),
      );
      const other = await make(
        dan,
        timed('Ours', '2031-03-27', '10:00', '11:00', { reminderMinutes: 60 }),
      );
      await reminders().run(at('2031-03-27T07:30:00Z'));
      const globexClaims = await system.calendarReminder.findMany({ where: { eventId: mine.id } });
      expect(globexClaims).toHaveLength(1);
      expect(globexClaims[0]?.tenantId).toBe(globex.tenantId);
      const acmeClaims = await system.calendarReminder.findMany({ where: { eventId: other.id } });
      expect(acmeClaims[0]?.tenantId).toBe(acme.tenantId);
      const globexOutbox = await system.outboxEvent.findMany({
        where: { tenantId: globex.tenantId, type: 'calendar.reminder' },
      });
      expect(globexOutbox.map((r) => (r.params as { eventId: string }).eventId)).toEqual([mine.id]);
      // another workspace cannot claim an occurrence of this event
      await expect(
        system.calendarReminder.create({
          data: {
            tenantId: acme.tenantId,
            eventId: mine.id,
            occurrenceDate: new Date('2031-03-28T00:00:00Z'),
          },
        }),
      ).rejects.toThrow();
    });
  });
});
