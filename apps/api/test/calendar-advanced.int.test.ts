import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  builtInHolidays,
  calendarEventListSchema,
  calendarEventSchema,
  employeeSchema,
  findTimeResponseSchema,
  personalDataExportSchema,
  todayIn,
  weekStartOf,
  yearOf,
  type CalendarEvent,
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

describe.skipIf(!urls)('advanced calendar over HTTP (real database)', () => {
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
  let sam: Person; // never involved
  let teamId: string;

  const today = todayIn(ZONE);
  /** A Monday three weeks ahead or later whose week has no public holiday. */
  const mon = (() => {
    let d = weekStartOf(addDays(today, 21));
    const holidays = new Set(
      [yearOf(d), yearOf(d) + 1].flatMap((y) => builtInHolidays('BG', y).map((h) => h.date)),
    );
    while ([0, 1, 2, 3, 4, 5, 6].some((n) => holidays.has(addDays(d, n)))) d = addDays(d, 7);
    return d;
  })();
  const day = (n: number) => addDays(mon, n);

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

  const timed = (
    title: string,
    date: string,
    startTime: string,
    endTime: string,
    extra: object = {},
  ) => ({
    scope: 'personal',
    title,
    allDay: false,
    startDate: date,
    endDate: date,
    startTime,
    endTime,
    ...extra,
  });
  const post = (as: Member, body: object) => as.agent.post(`${api}/calendar/events`).send(body);
  const make = async (as: Member, body: object): Promise<CalendarEvent> => {
    const res = await post(as, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return calendarEventSchema.parse(res.body);
  };
  const list = async (as: Member, from: string, to: string): Promise<CalendarEvent[]> => {
    const res = await as.agent.get(`${api}/calendar/events`).query({ from, to });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return calendarEventListSchema.parse(res.body).items;
  };
  const dates = (items: CalendarEvent[], id?: string) =>
    items.filter((e) => !id || e.id === id).map((e) => e.startDate);
  const patch = (as: Member, id: string, body: object, query: object = {}) =>
    as.agent.patch(`${api}/calendar/events/${id}`).query(query).send(body);
  const del = (as: Member, id: string, query: object = {}) =>
    as.agent.delete(`${api}/calendar/events/${id}`).query(query);
  const respond = (as: Member, id: string, response: string) =>
    as.agent.put(`${api}/calendar/events/${id}/response`).send({ response });
  const outbox = (type: string) =>
    system.outboxEvent.findMany({
      where: { tenantId: acme.tenantId, type },
      orderBy: { createdAt: 'asc' },
    });
  const findTime = (as: Member, body: object) =>
    as.agent.post(`${api}/calendar/find-time`).send(body);
  const slots = async (as: Member, body: object) => {
    const res = await findTime(as, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return findTimeResponseSchema.parse(res.body).slots;
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
    sam = await onboard(acme, 'sam');
    const dep = await acme.admin.agent.post(`${api}/org/departments`).send({ name: 'Eng' });
    expect(dep.status, JSON.stringify(dep.body)).toBe(201);
    const team = await acme.admin.agent.post(`${api}/org/teams`).send({
      name: 'Crew',
      departmentId: (dep.body as { id: string }).id,
      leadEmployeeId: mia.employeeId,
    });
    expect(team.status, JSON.stringify(team.body)).toBe(201);
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

  describe('repeating events', () => {
    it('expands a weekly series on several weekdays inside the window, all with the series id', async () => {
      const series = await make(
        dan,
        timed('Standup', day(0), '09:00', '09:15', {
          recurrence: { freq: 'weekly', weekdays: [0, 2], count: 5 },
        }),
      );
      expect(series.recurrence).toMatchObject({ freq: 'weekly', weekdays: [0, 2], count: 5 });
      const items = (await list(dan, day(0), day(27))).filter((e) => e.id === series.id);
      expect(dates(items)).toEqual([day(0), day(2), day(7), day(9), day(14)]);
      expect(items.every((e) => e.startTime === '09:00' && e.occurrenceDate === e.startDate)).toBe(
        true,
      );
      // a window inside the series shows only what falls in it
      expect(dates(await list(dan, day(8), day(10)), series.id)).toEqual([day(9)]);
      // the series is nobody else's
      expect(dates(await list(sam, day(0), day(27)), series.id)).toEqual([]);
    });

    it('repeats monthly on the last day when the month is shorter', async () => {
      const start = '2027-01-31';
      const series = await make(
        eve,
        timed('Month end', start, '10:00', '10:30', { recurrence: { freq: 'monthly', count: 3 } }),
      );
      const items = await list(eve, '2027-01-01', '2027-03-31');
      expect(dates(items, series.id)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    });

    it('shows a multi-day occurrence that began before the window', async () => {
      const series = await make(eve, {
        scope: 'personal',
        title: 'Offsite',
        allDay: true,
        startDate: day(0),
        endDate: day(2),
        recurrence: { freq: 'weekly', count: 3 },
      });
      const items = await list(eve, day(8), day(8)); // the second Monday-to-Wednesday block
      const found = items.find((e) => e.id === series.id)!;
      expect(found).toMatchObject({ startDate: day(7), endDate: day(9) });
    });

    it.each([
      ['an end date and a count', { freq: 'daily', until: '2030-01-01', count: 3 }],
      ['weekdays on a daily rule', { freq: 'daily', weekdays: [1] }],
      ['an end before the start', { freq: 'daily', until: '2000-01-01' }],
      ['an unknown frequency', { freq: 'hourly' }],
      ['an interval of 0', { freq: 'daily', interval: 0 }],
    ])('refuses a repeat with %s', async (_name, recurrence) => {
      const res = await post(dan, timed('Bad', day(0), '09:00', '10:00', { recurrence }));
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    });

    it('is checked by the database too', async () => {
      const bad = [
        { recurrenceFreq: 'weekly', recurrenceWeekdays: [7] },
        { recurrenceFreq: 'daily', recurrenceWeekdays: [1] },
        { recurrenceFreq: 'daily', recurrenceInterval: 31 },
        { recurrenceFreq: null, recurrenceCount: 3 },
        {
          recurrenceFreq: 'daily',
          recurrenceCount: 3,
          recurrenceUntil: new Date('2099-01-01T00:00:00Z'),
        },
        { recurrenceFreq: 'daily', recurrenceUntil: new Date('2000-01-01T00:00:00Z') },
      ];
      for (const data of bad) {
        await expect(
          system.calendarEvent.create({
            data: {
              tenantId: acme.tenantId,
              scope: 'personal',
              ownerEmployeeId: dan.employeeId,
              title: 'x',
              allDay: true,
              startDate: new Date(`${day(0)}T00:00:00Z`),
              endDate: new Date(`${day(0)}T00:00:00Z`),
              ...data,
            },
          }),
        ).rejects.toThrow();
      }
    });
  });

  describe('changing and deleting one occurrence or the rest of a series', () => {
    const series = async (as: Member, extra: object = {}) =>
      make(
        as,
        timed('Weekly sync', day(0), '14:00', '15:00', {
          recurrence: { freq: 'weekly' },
          ...extra,
        }),
      );
    const seriesDates = async (as: Member, id: string, to = 35) =>
      dates(await list(as, day(0), day(to)), id);

    it('deletes one occurrence only', async () => {
      const s = await series(dan);
      expect((await del(dan, s.id, { mode: 'this', occurrence: day(7) })).status).toBe(204);
      expect(await seriesDates(dan, s.id)).toEqual([day(0), day(14), day(21), day(28), day(35)]);
      // it cannot be cancelled twice
      expect((await del(dan, s.id, { mode: 'this', occurrence: day(7) })).status).toBe(404);
    });

    it('deletes this and the following occurrences and keeps the earlier ones', async () => {
      const s = await series(dan);
      expect((await del(dan, s.id, { mode: 'following', occurrence: day(14) })).status).toBe(204);
      expect(await seriesDates(dan, s.id, 56)).toEqual([day(0), day(7)]);
    });

    it('deletes the whole series when the first occurrence is deleted as "following" or "all"', async () => {
      const a = await series(dan);
      expect((await del(dan, a.id, { mode: 'following', occurrence: day(0) })).status).toBe(204);
      expect(await seriesDates(dan, a.id)).toEqual([]);
      const b = await series(dan);
      expect((await del(dan, b.id)).status).toBe(204);
      expect(await seriesDates(dan, b.id)).toEqual([]);
    });

    it('keeps the rest of the series when only the first occurrence is deleted or changed', async () => {
      const a = await series(dan);
      expect((await del(dan, a.id, { mode: 'this', occurrence: day(0) })).status).toBe(204);
      expect(await seriesDates(dan, a.id)).toEqual([day(7), day(14), day(21), day(28), day(35)]);
      const b = await series(dan);
      const res = await patch(
        dan,
        b.id,
        { title: 'First only' },
        { mode: 'this', occurrence: day(0) },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await seriesDates(dan, b.id)).toEqual([day(7), day(14), day(21), day(28), day(35)]);
      const items = await list(dan, day(0), day(0));
      expect(items.find((e) => e.title === 'First only')?.recurrence).toBeNull();
    });

    it('turns one occurrence into a separate event with the changes', async () => {
      const s = await series(dan);
      const res = await patch(
        dan,
        s.id,
        { title: 'Moved sync', startTime: '16:00', endTime: '17:00' },
        { mode: 'this', occurrence: day(7) },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const one = calendarEventSchema.parse(res.body);
      expect(one.id).not.toBe(s.id);
      expect(one).toMatchObject({
        title: 'Moved sync',
        startDate: day(7),
        startTime: '16:00',
        recurrence: null,
      });
      const items = await list(dan, day(0), day(14));
      expect(dates(items, s.id)).toEqual([day(0), day(14)]);
      expect(items.find((e) => e.id === one.id)?.startTime).toBe('16:00');
      expect(items.find((e) => e.id === s.id)?.title).toBe('Weekly sync');
    });

    it('splits a series at an occurrence for "this and following"', async () => {
      const s = await series(dan);
      const res = await patch(
        dan,
        s.id,
        { title: 'New format', startTime: '15:30', endTime: '16:00' },
        { mode: 'following', occurrence: day(14) },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const next = calendarEventSchema.parse(res.body);
      expect(next.id).not.toBe(s.id);
      expect(next).toMatchObject({ title: 'New format', recurrence: { freq: 'weekly' } });
      const items = await list(dan, day(0), day(28));
      expect(dates(items, s.id)).toEqual([day(0), day(7)]);
      expect(dates(items, next.id)).toEqual([day(14), day(21), day(28)]);
      expect(items.find((e) => e.id === next.id)?.startTime).toBe('15:30');
      expect(items.find((e) => e.id === s.id)?.startTime).toBe('14:00');
    });

    it('keeps the total of a counted series when it is split, and moves later cancellations along', async () => {
      const s = await make(
        dan,
        timed('Counted', day(0), '08:00', '08:30', { recurrence: { freq: 'daily', count: 6 } }),
      );
      expect((await del(dan, s.id, { mode: 'this', occurrence: day(4) })).status).toBe(204);
      const res = await patch(
        dan,
        s.id,
        { title: 'Counted B' },
        { mode: 'following', occurrence: day(3) },
      );
      const next = calendarEventSchema.parse(res.body);
      const items = await list(dan, day(0), day(10));
      expect(dates(items, s.id)).toEqual([day(0), day(1), day(2)]);
      // 6 occurrences in all: 3 before, 3 after the split, minus the one cancelled on day 4
      expect(dates(items, next.id)).toEqual([day(3), day(5)]);
    });

    it('moves the whole series when an occurrence is moved "for all"', async () => {
      const s = await series(dan);
      const res = await patch(
        dan,
        s.id,
        { startDate: day(8), endDate: day(8) },
        { mode: 'all', occurrence: day(7) },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = await list(dan, day(0), day(30));
      expect(dates(items, s.id)).toEqual([day(1), day(8), day(15), day(22), day(29)]);
    });

    it('makes a one-off event repeat and a series a one-off event', async () => {
      const one = await make(dan, timed('Once', day(0), '11:00', '11:30'));
      expect(one.recurrence).toBeNull();
      const rep = await patch(dan, one.id, { recurrence: { freq: 'daily', count: 3 } });
      expect(rep.status, JSON.stringify(rep.body)).toBe(200);
      expect(dates(await list(dan, day(0), day(10)), one.id)).toEqual([day(0), day(1), day(2)]);
      const back = await patch(dan, one.id, { recurrence: null });
      expect(back.status).toBe(200);
      expect(dates(await list(dan, day(0), day(10)), one.id)).toEqual([day(0)]);
    });

    it.each([
      ['this without an occurrence', { mode: 'this' }, 400],
      ['following without an occurrence', { mode: 'following' }, 400],
      ['a date that is not in the series', { mode: 'this', occurrence: day(3) }, 404],
      ['an unknown mode', { mode: 'some', occurrence: day(7) }, 400],
    ])('refuses %s', async (_name, query, status) => {
      const s = await series(dan);
      expect((await patch(dan, s.id, { title: 'x' }, query)).status).toBe(status);
      expect((await del(dan, s.id, query)).status).toBe(status);
    });

    it('refuses "this" and "following" on an event that does not repeat', async () => {
      const one = await make(dan, timed('Single', day(0), '12:00', '12:30'));
      const res = await del(dan, one.id, { mode: 'this', occurrence: day(0) });
      expect(res.status).toBe(400);
      expect(errorBody(res).details?.[0]?.code).toBe('not_recurring');
    });

    it('audits team series with ids only', async () => {
      const t = await make(mia, {
        scope: 'team',
        teamId,
        title: 'Secret roadmap talk',
        allDay: true,
        startDate: day(0),
        endDate: day(0),
        recurrence: { freq: 'weekly' },
      });
      await del(mia, t.id, { mode: 'this', occurrence: day(7) });
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, entityId: t.id },
      });
      expect(entries.length).toBeGreaterThan(0);
      expect(JSON.stringify(entries)).not.toContain('Secret roadmap');
    });
  });

  describe('guests and answers', () => {
    let meeting: CalendarEvent;

    it('invites colleagues to a personal event, who then see it with the guest list', async () => {
      meeting = await make(
        dan,
        timed('Design review', day(1), '10:00', '11:00', {
          attendeeIds: [eve.employeeId, mia.employeeId],
        }),
      );
      expect(meeting.isOrganizer).toBe(true);
      expect(meeting.attendees.map((a) => [a.employee.firstName, a.response]).sort()).toEqual([
        ['eve', 'needs_action'],
        ['mia', 'needs_action'],
      ]);
      const seen = (await list(eve, day(1), day(1))).find((e) => e.id === meeting.id)!;
      expect(seen).toMatchObject({
        title: 'Design review',
        isOrganizer: false,
        canEdit: false,
        myResponse: 'needs_action',
      });
      expect(seen.attendees).toHaveLength(2);
      expect((await list(sam, day(1), day(1))).some((e) => e.id === meeting.id)).toBe(false);
      expect((await list(hr, day(1), day(1))).some((e) => e.id === meeting.id)).toBe(false);
    });

    it('tells guests with the event id and the date only', async () => {
      const notes = await outbox('calendar.invited');
      const mine = notes.filter((n) => (n.params as { eventId?: string }).eventId === meeting.id);
      expect(mine).toHaveLength(2);
      expect(
        mine.map((n) => (n.params as { recipientUserId: string }).recipientUserId).sort(),
      ).toEqual([eve.id, mia.id].sort());
      for (const n of mine) {
        expect(Object.keys(n.params as object).sort()).toEqual([
          'date',
          'eventId',
          'recipientUserId',
        ]);
      }
      expect(JSON.stringify(notes)).not.toContain('Design review');
    });

    it('keeps guests from changing or deleting the event; others do not know it exists', async () => {
      expect((await patch(eve, meeting.id, { title: 'Hijacked' })).status).toBe(403);
      expect((await del(eve, meeting.id)).status).toBe(403);
      for (const other of [sam, hr, acme.admin, globex.admin]) {
        expect((await patch(other, meeting.id, { title: 'x' })).status).toBe(404);
        expect((await del(other, meeting.id)).status).toBe(404);
        expect((await respond(other, meeting.id, 'accepted')).status).toBe(404);
      }
    });

    it('lets a guest answer; the organizer sees it and is told once per change', async () => {
      const res = await respond(eve, meeting.id, 'accepted');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(calendarEventSchema.parse(res.body).myResponse).toBe('accepted');
      const seen = (await list(dan, day(1), day(1))).find((e) => e.id === meeting.id)!;
      expect(seen.attendees.find((a) => a.employee.firstName === 'eve')?.response).toBe('accepted');

      await respond(eve, meeting.id, 'accepted'); // the same answer again tells nobody
      let notes = (await outbox('calendar.response')).filter(
        (n) => (n.params as { eventId?: string }).eventId === meeting.id,
      );
      expect(notes).toHaveLength(1);
      expect(notes[0]?.params).toMatchObject({
        recipientUserId: dan.id,
        response: 'accepted',
        date: day(1),
      });
      await respond(eve, meeting.id, 'declined');
      await respond(mia, meeting.id, 'tentative');
      notes = (await outbox('calendar.response')).filter(
        (n) => (n.params as { eventId?: string }).eventId === meeting.id,
      );
      expect(notes.map((n) => (n.params as { response: string }).response)).toEqual([
        'accepted',
        'declined',
        'tentative',
      ]);
    });

    it('refuses answers that are not accepted, declined or tentative, and an answer from the organizer', async () => {
      for (const response of ['needs_action', 'yes', '']) {
        expect((await respond(eve, meeting.id, response)).status).toBe(400);
      }
      expect((await respond(dan, meeting.id, 'accepted')).status).toBe(404);
    });

    it('replaces the guest list: new guests are invited, removed ones lose access, the others keep their answer', async () => {
      const before = (await outbox('calendar.invited')).length;
      const res = await patch(dan, meeting.id, { attendeeIds: [mia.employeeId, sam.employeeId] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const updated = calendarEventSchema.parse(res.body);
      expect(updated.attendees.map((a) => [a.employee.firstName, a.response]).sort()).toEqual([
        ['mia', 'tentative'],
        ['sam', 'needs_action'],
      ]);
      expect((await outbox('calendar.invited')).length).toBe(before + 1);
      expect((await list(eve, day(1), day(1))).some((e) => e.id === meeting.id)).toBe(false);
      expect((await list(sam, day(1), day(1))).some((e) => e.id === meeting.id)).toBe(true);
    });

    it('resets answers and tells guests when the time changes, but not for a new title', async () => {
      const changed = (await outbox('calendar.changed')).length;
      await patch(dan, meeting.id, { title: 'Design review (renamed)' });
      let seen = (await list(mia, day(1), day(1))).find((e) => e.id === meeting.id)!;
      expect(seen.myResponse).toBe('tentative');
      expect((await outbox('calendar.changed')).length).toBe(changed);

      await patch(dan, meeting.id, { startTime: '13:00', endTime: '14:00' });
      seen = (await list(mia, day(1), day(1))).find((e) => e.id === meeting.id)!;
      expect(seen.myResponse).toBe('needs_action');
      const notes = (await outbox('calendar.changed')).slice(changed);
      expect(notes).toHaveLength(2);
      expect(notes.every((n) => (n.params as { action: string }).action === 'updated')).toBe(true);
      expect(JSON.stringify(notes)).not.toContain('Design review');
    });

    it('tells guests when the event is deleted', async () => {
      const before = (await outbox('calendar.changed')).length;
      expect((await del(dan, meeting.id)).status).toBe(204);
      const notes = (await outbox('calendar.changed')).slice(before);
      expect(notes.map((n) => (n.params as { action: string }).action)).toEqual([
        'cancelled',
        'cancelled',
      ]);
      expect((await list(mia, day(1), day(1))).some((e) => e.id === meeting.id)).toBe(false);
    });

    it.each([
      ['the organizer', () => [dan.employeeId]],
      ['a person twice', () => [eve.employeeId, eve.employeeId]],
      ['an unknown person', () => [UNKNOWN]],
      ['a person of another workspace', () => ['GLOBEX']],
    ])('refuses a guest list with %s', async (name, ids) => {
      const guestIds =
        name === 'a person of another workspace' ? [(await onboardOnce()).employeeId] : ids();
      const res = await post(
        dan,
        timed('Bad guests', day(2), '10:00', '11:00', { attendeeIds: guestIds }),
      );
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    });

    it('refuses guests on team and company events and an inactive guest', async () => {
      for (const extra of [{ scope: 'team', teamId }, { scope: 'company' }]) {
        const res = await post(
          hr,
          timed('x', day(2), '10:00', '11:00', { ...extra, attendeeIds: [eve.employeeId] }),
        );
        expect(res.status).toBe(400);
      }
      const gone = await onboard(acme, 'gone');
      await acme.admin.agent
        .post(`${api}/employees/${gone.employeeId}/deactivate`)
        .send({ terminationDate: today });
      expect(
        (await post(dan, timed('x', day(2), '10:00', '11:00', { attendeeIds: [gone.employeeId] })))
          .status,
      ).toBe(400);
    });

    it('keeps guests of a series: they see every occurrence and answer for all of them', async () => {
      const s = await make(
        dan,
        timed('Weekly 1:1', day(0), '16:00', '16:30', {
          recurrence: { freq: 'weekly', count: 3 },
          attendeeIds: [eve.employeeId],
        }),
      );
      expect(dates(await list(eve, day(0), day(30)), s.id)).toEqual([day(0), day(7), day(14)]);
      await respond(eve, s.id, 'accepted');
      const seen = await list(dan, day(0), day(30));
      expect(
        seen.filter((e) => e.id === s.id).every((e) => e.attendees[0]?.response === 'accepted'),
      ).toBe(true);
      // "this occurrence" copies the guests as a new event; they are told it changed
      const before = (await outbox('calendar.changed')).length;
      const res = await patch(
        dan,
        s.id,
        { startTime: '17:00', endTime: '17:30' },
        { mode: 'this', occurrence: day(7) },
      );
      const one = calendarEventSchema.parse(res.body);
      expect(one.attendees.map((a) => [a.employee.firstName, a.response])).toEqual([
        ['eve', 'needs_action'],
      ]);
      expect((await outbox('calendar.changed')).length).toBe(before + 1);
    });
  });

  let extraGlobex: Person | undefined;
  async function onboardOnce(): Promise<Person> {
    extraGlobex ??= await onboard(globex, 'gina');
    return extraGlobex;
  }

  describe('database rules for guests', () => {
    it('allows guests on personal events of another person only', async () => {
      const personal = await make(dan, timed('Db personal', day(3), '09:00', '10:00'));
      const team = await make(mia, {
        scope: 'team',
        teamId,
        title: 'Db team',
        allDay: true,
        startDate: day(3),
        endDate: day(3),
      });
      const attendee = (eventId: string, employeeId: string, response = 'needs_action') =>
        system.calendarAttendee.create({
          data: { tenantId: acme.tenantId, eventId, employeeId, response },
        });
      await expect(attendee(team.id, eve.employeeId)).rejects.toThrow();
      await expect(attendee(personal.id, dan.employeeId)).rejects.toThrow(); // the organizer
      await expect(attendee(personal.id, eve.employeeId, 'maybe')).rejects.toThrow();
      await attendee(personal.id, eve.employeeId);
      await expect(attendee(personal.id, eve.employeeId)).rejects.toThrow(); // twice
      expect(await system.calendarAttendee.count({ where: { eventId: personal.id } })).toBe(1);
    });
  });

  describe('tenant isolation', () => {
    it("another workspace cannot see, change or answer this workspace's events", async () => {
      const e = await make(
        dan,
        timed('Private', day(4), '09:00', '10:00', { attendeeIds: [eve.employeeId] }),
      );
      expect(await list(globex.admin, day(4), day(4))).toEqual([]);
      expect((await patch(globex.admin, e.id, { title: 'x' })).status).toBe(404);
      expect((await respond(globex.admin, e.id, 'accepted')).status).toBe(404);
      expect((await del(globex.admin, e.id, { mode: 'this', occurrence: day(4) })).status).toBe(
        404,
      );
    });

    it('cannot invite or look up the free time of people from another workspace', async () => {
      const outsider = await onboardOnce();
      const res = await post(
        dan,
        timed('x', day(4), '11:00', '12:00', { attendeeIds: [outsider.employeeId] }),
      );
      expect(res.status).toBe(400);
      const ft = await findTime(dan, {
        employeeIds: [outsider.employeeId],
        from: day(0),
        to: day(4),
        durationMinutes: 30,
      });
      expect(ft.status).toBe(400);
      expect(await system.calendarAttendee.count({ where: { tenantId: globex.tenantId } })).toBe(0);
    });
  });

  describe('finding a time', () => {
    // A quiet week of its own, far from the other tests' events: Monday of the week 6 weeks on.
    const base = (() => {
      let d = addDays(mon, 42);
      const holidays = new Set(
        [yearOf(d), yearOf(d) + 1].flatMap((y) => builtInHolidays('BG', y).map((h) => h.date)),
      );
      // this week and the one two weeks on both have to be free of public holidays
      while (
        [0, 1, 2, 3, 4, 5, 6, 14, 15, 16, 17, 18, 19, 20].some((n) => holidays.has(addDays(d, n)))
      )
        d = addDays(d, 7);
      return d;
    })();
    const q = (ids: string[], extra: object = {}) => ({
      employeeIds: ids,
      from: base,
      to: addDays(base, 4),
      durationMinutes: 60,
      ...extra,
    });

    it('suggests the earliest slots in the common window when nobody is busy', async () => {
      const got = await slots(dan, q([dan.employeeId, eve.employeeId]));
      expect(got.slice(0, 3)).toEqual([
        { date: base, startTime: '09:00', endTime: '10:00' },
        { date: base, startTime: '09:30', endTime: '10:30' },
        { date: base, startTime: '10:00', endTime: '11:00' },
      ]);
      expect(got).toHaveLength(10);
      expect(Object.keys(got[0]!).sort()).toEqual(['date', 'endTime', 'startTime']);
    });

    it('works around meetings of any of the people, including events they were invited to', async () => {
      await make(dan, timed('Busy', base, '09:00', '10:30', { attendeeIds: [eve.employeeId] }));
      await make(sam, timed('Other', base, '10:30', '11:00'));
      const withEve = await slots(sam, q([sam.employeeId, eve.employeeId]));
      expect(withEve[0]).toEqual({ date: base, startTime: '11:00', endTime: '12:00' });
      // a declined invitation is not busy time
      const ev = (await list(eve, base, base)).find((e) => e.title === 'Busy')!;
      await respond(eve, ev.id, 'declined');
      const afterDecline = await slots(sam, q([eve.employeeId]));
      expect(afterDecline[0]).toEqual({ date: base, startTime: '09:00', endTime: '10:00' });
    });

    it('treats company events as busy time for everybody and team events for the team only', async () => {
      await make(hr, timed('All hands', addDays(base, 1), '09:00', '11:00', { scope: 'company' }));
      await make(
        mia,
        timed('Crew sync', addDays(base, 1), '11:00', '12:00', { scope: 'team', teamId }),
      );
      const outsider = await slots(
        sam,
        q([sam.employeeId], { from: addDays(base, 1), to: addDays(base, 1) }),
      );
      expect(outsider[0]).toEqual({ date: addDays(base, 1), startTime: '11:00', endTime: '12:00' });
      const member = await slots(
        dan,
        q([dan.employeeId], { from: addDays(base, 1), to: addDays(base, 1) }),
      );
      expect(member[0]).toEqual({ date: addDays(base, 1), startTime: '12:00', endTime: '13:00' });
    });

    it('is not blocked by all-day events', async () => {
      await make(hr, {
        scope: 'company',
        title: 'Day',
        allDay: true,
        startDate: addDays(base, 2),
        endDate: addDays(base, 2),
      });
      const got = await slots(
        sam,
        q([sam.employeeId], { from: addDays(base, 2), to: addDays(base, 2) }),
      );
      expect(got[0]).toEqual({ date: addDays(base, 2), startTime: '09:00', endTime: '10:00' });
    });

    it('counts the occurrences of a repeating event as busy time', async () => {
      await make(
        sam,
        timed('Daily standup', addDays(base, 3), '09:00', '09:30', {
          recurrence: { freq: 'daily', count: 3 },
        }),
      );
      const got = await slots(
        sam,
        q([sam.employeeId], { from: addDays(base, 3), to: addDays(base, 4) }),
      );
      expect(got[0]).toEqual({ date: addDays(base, 3), startTime: '09:30', endTime: '10:30' });
    });

    it('skips days when somebody is on approved leave, and weekends', async () => {
      const types = (await eve.agent.get(`${api}/leave/types`)).body as {
        id: string;
        key: string;
      }[];
      const leave = await eve.agent.post(`${api}/leave/requests`).send({
        leaveTypeId: types.find((t) => t.key === 'unpaid')!.id,
        startDate: addDays(base, 4),
        endDate: addDays(base, 4),
      });
      expect(leave.status, JSON.stringify(leave.body)).toBe(201);
      const ok = await hr.agent
        .post(`${api}/leave/requests/${(leave.body as { id: string }).id}/approve`)
        .send({});
      expect(ok.status).toBe(200);
      const got = await slots(sam, {
        employeeIds: [sam.employeeId, eve.employeeId],
        from: addDays(base, 4),
        to: addDays(base, 8), // Friday (leave), Saturday, Sunday, Monday
        durationMinutes: 60,
      });
      expect(new Set(got.map((s) => s.date))).toEqual(new Set([addDays(base, 7)]));
    });

    it("follows a person's own working hours", async () => {
      const part = await hr.agent.put(`${api}/employees/${sam.employeeId}/schedule`).send({
        validFrom: '2020-01-06',
        minutes: [0, 240, 240, 240, 0, 0, 0],
      });
      expect(part.status, JSON.stringify(part.body)).toBe(200);
      const got = await slots(
        sam,
        q([sam.employeeId], { from: addDays(base, 7), to: addDays(base, 8) }),
      );
      // Monday is a day off for Sam, Tuesday is a working day
      expect(got[0]?.date).toBe(addDays(base, 8));
    });

    it('stays inside the 09:00 to 18:00 window', async () => {
      const got = await slots(
        dan,
        q([dan.employeeId], {
          from: addDays(base, 16),
          to: addDays(base, 16),
          durationMinutes: 480,
        }),
      );
      expect(got.map((s) => s.startTime)).toEqual(['09:00', '09:30', '10:00']);
      expect(got.every((s) => s.endTime <= '18:00')).toBe(true);
    });

    it.each([
      ['no people', { employeeIds: [] }],
      [
        'more than 20 people',
        {
          employeeIds: Array.from(
            { length: 21 },
            (_, i) => `0192f5a0-0000-7000-8000-${String(i).padStart(12, '0')}`,
          ),
        },
      ],
      ['a duplicate', (ids: string[]) => ({ employeeIds: [ids[0], ids[0]] })],
      ['more than 14 days', { to: addDays(base, 14) }],
      ['an inverted period', { from: addDays(base, 4), to: base }],
      ['a duration under 15 minutes', { durationMinutes: 14 }],
      ['a duration over 8 hours', { durationMinutes: 481 }],
      ['an unknown field', { extra: 1 }],
    ])('refuses %s', async (_name, change) => {
      const body = typeof change === 'function' ? change([dan.employeeId]) : change;
      const res = await findTime(dan, { ...q([dan.employeeId]), ...body });
      expect(res.status).toBe(400);
    });

    it('is 400 for an unknown person and needs a signed-in user', async () => {
      const res = await findTime(dan, q([UNKNOWN]));
      expect(res.status).toBe(400);
      expect(errorBody(res).details?.[0]?.code).toBe('unknown_employee');
      const anon = await (
        await import('supertest')
      )
        .default(app.getHttpServer())
        .post(`${api}/calendar/find-time`)
        .send(q([dan.employeeId]));
      expect(anon.status).toBe(401);
    });
  });

  describe('personal data', () => {
    it('lists organized events with their guests and received invitations in the export', async () => {
      const mine = await make(
        eve,
        timed('Eve hosts', day(5), '10:00', '11:00', {
          attendeeIds: [dan.employeeId],
          recurrence: { freq: 'weekly', count: 2 },
        }),
      );
      await respond(dan, mine.id, 'accepted');
      const hostRes = await eve.agent.get(`${api}/privacy/export`);
      const host = personalDataExportSchema.parse(JSON.parse(hostRes.text));
      const ev = host.calendarEvents.find((e) => e.title === 'Eve hosts')!;
      expect(ev.repeats).toBe('weekly');
      expect(ev.guests).toEqual([{ name: 'dan Test', response: 'accepted' }]);
      const guestRes = await dan.agent.get(`${api}/privacy/export`);
      const guest = personalDataExportSchema.parse(JSON.parse(guestRes.text));
      expect(guest.calendarInvitations).toContainEqual({
        title: 'Eve hosts',
        organizer: 'eve Test',
        startDate: day(5),
        response: 'accepted',
      });
    });

    it('erasure removes the invitations of the person and the guests of their own events', async () => {
      const hostile = await onboard(acme, 'ida');
      const idaEvent = await make(
        hostile,
        timed('Ida hosts', day(6), '10:00', '11:00', { attendeeIds: [eve.employeeId] }),
      );
      const eveEvent = await make(
        eve,
        timed('Eve invites Ida', day(6), '12:00', '13:00', { attendeeIds: [hostile.employeeId] }),
      );
      expect(
        (
          await acme.admin.agent
            .post(`${api}/employees/${hostile.employeeId}/deactivate`)
            .send({ terminationDate: today })
        ).status,
      ).toBe(200);
      const erase = await hr.agent
        .post(`${api}/privacy/erase/${hostile.employeeId}`)
        .send({ confirm: true });
      expect(erase.status, JSON.stringify(erase.body)).toBe(204);
      expect(await system.calendarEvent.count({ where: { id: idaEvent.id } })).toBe(0);
      expect(
        await system.calendarAttendee.count({ where: { employeeId: hostile.employeeId } }),
      ).toBe(0);
      // the other person's event survives, without the erased guest
      const kept = (await list(eve, day(6), day(6))).find((e) => e.id === eveEvent.id)!;
      expect(kept.attendees).toEqual([]);
    });
  });
});
