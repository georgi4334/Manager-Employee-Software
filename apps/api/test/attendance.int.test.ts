import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  attendanceRecordListSchema,
  attendanceRecordSchema,
  attendanceStatusSchema,
  employeeSchema,
  presenceSchema,
  todayIn,
  zonedToUtc,
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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!urls)('attendance over HTTP (real database)', () => {
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
  let mia: Person; // manager
  let dan: Person; // reports to mia
  let eve: Person; // reports to dan
  let gus: Person; // nobody's report

  const today = todayIn(ZONE);
  const ago = (days: number) => addDays(today, -days);
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
  const manage = (ws: Workspace, employeeId: string, managerId: string | null) =>
    ws.admin.agent
      .put(`/api/v1/org/employees/${employeeId}/assignment`)
      .send({ managerId, departmentId: null });

  const checkIn = (who: Member, body: object = { mode: 'office' }) =>
    who.agent.post('/api/v1/attendance/check-in').send(body);
  const checkOut = (who: Member, body: object = {}) =>
    who.agent.post('/api/v1/attendance/check-out').send(body);
  const entry = (who: Member, body: object) =>
    who.agent.post('/api/v1/attendance/records').send(body);
  const day = (date: string, startTime = '09:00', endTime = '17:30', extra: object = {}) => ({
    date,
    startTime,
    endTime,
    mode: 'office',
    ...extra,
  });
  const list = async (who: Member, query: object) => {
    const res = await who.agent.get('/api/v1/attendance/records').query(query);
    expect(res.status).toBe(200);
    return attendanceRecordListSchema.parse(res.body);
  };
  const notesOf = async (who: Member) => {
    await app.get(OutboxWorker).runOnce();
    const res = await who.agent.get('/api/v1/notifications');
    return res.body.items as { type: string; params: Record<string, unknown> }[];
  };
  const insertRecord = (
    employeeId: string,
    checkInAt: Date,
    checkOutAt: Date | null,
    extra: object = {},
  ) =>
    system.attendanceRecord.create({
      data: {
        tenantId: acme.tenantId,
        employeeId,
        workDate: new Date(`${todayIn(ZONE, checkInAt)}T00:00:00Z`),
        checkInAt,
        checkOutAt,
        mode: 'office',
        ...extra,
      },
    });
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    hr = await onboard(acme, 'hrx', 'hr');
    mia = await onboard(acme, 'mia', 'manager');
    dan = await onboard(acme, 'dan');
    eve = await onboard(acme, 'eve');
    gus = await onboard(acme, 'gus');
    const adminEmployee = employeeSchema.parse(
      (await acme.admin.agent.get('/api/v1/employees/me')).body,
    ).id;
    for (const [who, manager] of [
      [mia, adminEmployee],
      [hr, adminEmployee],
      [dan, mia.employeeId],
      [eve, dan.employeeId],
    ] as const) {
      expect((await manage(acme, who.employeeId, manager)).status).toBe(204);
    }
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe('the clock', () => {
    it('checks in, shows the open record, and checks out with the duration', async () => {
      const person = await onboard(acme, 'clockx');
      const empty = attendanceStatusSchema.parse(
        (await person.agent.get('/api/v1/attendance/status')).body,
      );
      expect(empty).toMatchObject({ open: null, records: [], minutes: 0, today });

      const res = await checkIn(person, { mode: 'remote', note: ' from home ' });
      expect(res.status).toBe(201);
      const open = attendanceRecordSchema.parse(res.body);
      expect(open).toMatchObject({
        mode: 'remote',
        note: 'from home',
        open: true,
        minutes: null,
        endTime: null,
        source: 'clock',
        date: today,
      });
      expect(open.startTime).toMatch(/^\d{2}:\d{2}$/);
      const status = attendanceStatusSchema.parse(
        (await person.agent.get('/api/v1/attendance/status')).body,
      );
      expect(status.open?.id).toBe(open.id);

      await sleep(20);
      const out = await checkOut(person);
      expect(out.status).toBe(200);
      expect(attendanceRecordSchema.parse(out.body)).toMatchObject({
        id: open.id,
        open: false,
        minutes: 0,
      });
      expect(
        attendanceStatusSchema.parse((await person.agent.get('/api/v1/attendance/status')).body)
          .open,
      ).toBeNull();
    });

    it('refuses a second check-in and a check-out without an open record', async () => {
      const person = await onboard(acme, 'clocktwice');
      const noOpen = await checkOut(person);
      expect([noOpen.status, errorBody(noOpen).params]).toEqual([409, { field: 'open' }]);
      expect((await checkIn(person)).status).toBe(201);
      const again = await checkIn(person, { mode: 'remote' });
      expect([again.status, errorBody(again).params]).toEqual([409, { field: 'open' }]);
      expect(
        await system.attendanceRecord.count({ where: { employeeId: person.employeeId } }),
      ).toBe(1);
    });

    it('lets only one of two simultaneous check-ins through', async () => {
      const person = await onboard(acme, 'clockrace');
      const results = await Promise.all([
        checkIn(person),
        checkIn(person, { mode: 'field' }),
        checkIn(person),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(
        await system.attendanceRecord.count({
          where: { employeeId: person.employeeId, checkOutAt: null },
        }),
      ).toBe(1);
    });

    it.each([
      ['no mode', {}],
      ['an unknown mode', { mode: 'beach' }],
      ['a note over 200 characters', { mode: 'office', note: 'x'.repeat(201) }],
      ['somebody else (mass assignment)', { mode: 'office', employeeId: UNKNOWN }],
      ['a time (the server clock decides)', { mode: 'office', at: '2026-01-01T08:00:00Z' }],
    ])('rejects a check-in with %s', async (_label, body) => {
      const person = await onboard(acme, `bad${Math.random().toString(36).slice(2, 7)}`);
      const res = await checkIn(person, body);
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('closes an open record at the time the person really left, within limits', async () => {
      const person = await onboard(acme, 'clockat');
      await insertRecord(person.employeeId, hoursAgo(5), null);
      const bad = async (at: string, code: string) => {
        const res = await checkOut(person, { at });
        expect([res.status, errorBody(res).details?.[0]?.code]).toEqual([400, code]);
      };
      await bad(new Date(Date.now() + 3_600_000).toISOString(), 'in_future');
      await bad(hoursAgo(6).toISOString(), 'before_check_in');
      expect((await checkOut(person, { at: 'tomorrow' })).status).toBe(400);
      const ok = await checkOut(person, { at: hoursAgo(2).toISOString() });
      expect(attendanceRecordSchema.parse(ok.body)).toMatchObject({ minutes: 180, open: false });
    });

    it('does not close a record that is more than 16 hours old without a leaving time', async () => {
      const person = await onboard(acme, 'clockstale');
      await insertRecord(person.employeeId, hoursAgo(20), null);
      const res = await checkOut(person);
      expect([res.status, errorBody(res).details?.[0]?.code]).toEqual([400, 'too_long']);
      expect((await checkIn(person)).status).toBe(409); // still open: it has to be dealt with first
      const fixed = await checkOut(person, { at: hoursAgo(15).toISOString() });
      expect(fixed.status).toBe(200);
      expect((await checkIn(person)).status).toBe(201);
    });

    it('needs an active employee record, and a signed-in user', async () => {
      const lone = await (async () => {
        await acme.admin.agent.post('/api/v1/users/invitations').send({ email: 'loneatt@acme.eu' });
        return accept('loneatt@acme.eu');
      })();
      expect([
        (await checkIn(lone)).status,
        (await lone.agent.get('/api/v1/attendance/status')).status,
      ]).toEqual([404, 404]);
      const { agent } = httpWorkspaceHelpers(() => app);
      expect(
        (await agent().post('/api/v1/attendance/check-in').send({ mode: 'office' })).status,
      ).toBe(401);
      const gone = await onboard(acme, 'clockgone');
      await hr.agent.post(`/api/v1/employees/${gone.employeeId}/deactivate`).send({});
      expect((await checkIn(gone)).status).toBe(401); // the account is disabled with the employee
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('typing in a period', () => {
    it('records a day in the workspace time zone', async () => {
      const person = await onboard(acme, 'entryx');
      const res = await entry(
        person,
        day(ago(1), '09:00', '17:30', { note: 'Client site', mode: 'field' }),
      );
      expect(res.status).toBe(201);
      const r = attendanceRecordSchema.parse(res.body);
      expect(r).toMatchObject({
        date: ago(1),
        startTime: '09:00',
        endTime: '17:30',
        minutes: 510,
        mode: 'field',
        note: 'Client site',
        source: 'entry',
        open: false,
        canEdit: true,
      });
      expect(r.checkInAt).toBe(zonedToUtc(ago(1), '09:00', ZONE)!.toISOString());
      expect(r.checkOutAt).toBe(zonedToUtc(ago(1), '17:30', ZONE)!.toISOString());
    });

    it('allows the last 7 days for yourself, not the 8th and not the future', async () => {
      const person = await onboard(acme, 'entrywindow');
      expect((await entry(person, day(ago(7)))).status).toBe(201);
      for (const [label, date] of [
        ['eighth day back', ago(8)],
        ['tomorrow', addDays(today, 1)],
      ] as const) {
        const res = await entry(person, day(date));
        expect([res.status, errorBody(res).code], label).toEqual([400, 'VALIDATION_FAILED']);
      }
      const future = await entry(person, day(today, '08:00', '23:59'));
      expect([future.status, errorBody(future).details?.[0]?.code]).toEqual([400, 'in_future']);
    });

    it('refuses overlaps but allows records that touch', async () => {
      const person = await onboard(acme, 'entryoverlap');
      expect((await entry(person, day(ago(2), '09:00', '12:00'))).status).toBe(201);
      for (const [from, to] of [
        ['11:00', '13:00'],
        ['08:00', '09:30'],
        ['09:30', '10:30'],
        ['08:00', '18:00'],
      ]) {
        const res = await entry(person, day(ago(2), from, to));
        expect([res.status, errorBody(res).params], `${from}-${to}`).toEqual([
          409,
          { field: 'overlap' },
        ]);
      }
      expect((await entry(person, day(ago(2), '12:00', '13:00'))).status).toBe(201); // starts when the first ends
      expect((await entry(person, day(ago(2), '08:00', '09:00'))).status).toBe(201); // ends when the first starts
    });

    it('refuses an entry that overlaps an open record', async () => {
      const person = await onboard(acme, 'entryopen');
      await insertRecord(person.employeeId, zonedToUtc(ago(3), '10:00', ZONE)!, null);
      const res = await entry(person, day(ago(3), '09:00', '11:00'));
      expect([res.status, errorBody(res).params]).toEqual([409, { field: 'overlap' }]);
      expect((await entry(person, day(ago(3), '08:00', '10:00'))).status).toBe(201); // ends when the open one starts
      expect((await entry(person, day(ago(4), '08:00', '09:00'))).status).toBe(201); // the day before
    });

    it.each([
      ['an end before the start', day(ago(3), '17:00', '09:00')],
      ['an end equal to the start', day(ago(3), '09:00', '09:00')],
      ['more than 16 hours', day(ago(3), '00:00', '17:00')],
      ['a bad time', day(ago(3), '9am', '17:00')],
      ['a bad date', day('2026-02-30')],
      ['an unknown mode', day(ago(3), '09:00', '10:00', { mode: 'moon' })],
      ['a source (mass assignment)', day(ago(3), '09:00', '10:00', { source: 'correction' })],
    ])('rejects %s', async (_label, body) => {
      const person = await onboard(acme, `entrybad${Math.random().toString(36).slice(2, 6)}`);
      const res = await entry(person, body);
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('allows exactly 16 hours', async () => {
      const person = await onboard(acme, 'entry16');
      const res = await entry(person, day(ago(3), '00:00', '16:00'));
      expect(attendanceRecordSchema.parse(res.body).minutes).toBe(960);
    });

    it('knows that a time can be missing when the clocks go forward', async () => {
      const person = await onboard(acme, 'entrygap');
      // 29 March 2026: 03:00 jumps to 04:00 in Sofia; on 26 October 2025 the clocks go back.
      const res = await entry(hr, {
        ...day('2026-03-29', '03:30', '05:00'),
        employeeId: person.employeeId,
      });
      expect([res.status, errorBody(res).details?.[0]?.code]).toEqual([400, 'nonexistent_time']);
      const fine = await entry(hr, {
        ...day('2026-03-29', '04:00', '05:00'),
        employeeId: person.employeeId,
      });
      expect(attendanceRecordSchema.parse(fine.body).minutes).toBe(60);
      const longDay = await entry(hr, {
        ...day('2025-10-26', '00:00', '04:00'),
        employeeId: person.employeeId,
      });
      expect(attendanceRecordSchema.parse(longDay.body).minutes).toBe(5 * 60); // the 03:00-04:00 hour happens twice
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('corrections by other people', () => {
    it('lets a manager correct a report (and below) but nobody outside the scope, and tells the person', async () => {
      const w = day(ago(20));
      const forDan = await entry(mia, {
        ...w,
        employeeId: dan.employeeId,
        note: 'Forgot to check in',
      });
      expect(forDan.status).toBe(201);
      expect(attendanceRecordSchema.parse(forDan.body)).toMatchObject({
        source: 'correction',
        canEdit: true,
      });
      expect((await entry(mia, { ...w, employeeId: eve.employeeId })).status).toBe(201); // below, scope "team"
      const outside = await entry(mia, { ...w, employeeId: gus.employeeId });
      expect([outside.status, errorBody(outside).code]).toEqual([403, 'FORBIDDEN']);
      expect((await entry(mia, { ...w, employeeId: hr.employeeId })).status).toBe(403);
      expect((await entry(hr, { ...w, employeeId: gus.employeeId })).status).toBe(201);

      const notes = await notesOf(dan);
      const note = notes.find((n) => n.type === 'attendance.corrected');
      expect(note?.params).toEqual({ date: ago(20), action: 'created' });
      expect(JSON.stringify(note)).not.toMatch(/09:00|Forgot/);
    });

    it('does not let employees correct anybody, nor managers themselves on old days', async () => {
      const w = day(ago(21));
      for (const who of [dan, eve, gus]) {
        const res = await entry(who, { ...w, employeeId: mia.employeeId });
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      }
      for (const who of [mia, hr]) {
        const own = await entry(who, w); // yourself: only the last 7 days
        expect([own.status, errorBody(own).details?.[0]?.code]).toEqual([400, 'too_far_in_past']);
        const viaId = await entry(who, { ...w, employeeId: who.employeeId });
        expect(viaId.status).toBe(400);
      }
    });

    it('rejects unknown employees and employees of other workspaces', async () => {
      const foreign = await system.employee.findFirstOrThrow({
        where: { tenantId: globex.tenantId },
      });
      for (const id of [UNKNOWN, foreign.id]) {
        const res = await entry(hr, { ...day(ago(22)), employeeId: id });
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      expect(
        (await entry(hr, { ...day(addDays(today, 1)), employeeId: gus.employeeId })).status,
      ).toBe(400);
    });

    it('changes and deletes records: owner within 7 days, correctors for their scope, audited without times', async () => {
      const person = await onboard(acme, 'chgx');
      await manage(acme, person.employeeId, mia.employeeId);
      const created = attendanceRecordSchema.parse((await entry(person, day(ago(2)))).body);
      const patch = (who: Member, id: string, body: object) =>
        who.agent.patch(`/api/v1/attendance/records/${id}`).send(body);

      // the owner
      const own = await patch(person, created.id, {
        startTime: '08:30',
        endTime: '16:00',
        mode: 'remote',
        note: 'Changed',
      });
      expect(attendanceRecordSchema.parse(own.body)).toMatchObject({
        startTime: '08:30',
        endTime: '16:00',
        minutes: 450,
        mode: 'remote',
        note: 'Changed',
        source: 'entry',
      });
      expect(
        attendanceRecordSchema.parse((await patch(person, created.id, { note: null })).body).note,
      ).toBeNull();

      // the manager (correction), the colleague (refused)
      const byManager = await patch(mia, created.id, { endTime: '17:00' });
      expect(attendanceRecordSchema.parse(byManager.body)).toMatchObject({
        endTime: '17:00',
        source: 'correction',
      });
      expect((await patch(gus, created.id, { mode: 'office' })).status).toBe(403);
      expect((await patch(eve, created.id, { mode: 'office' })).status).toBe(403);
      const notes = await notesOf(person);
      expect(
        notes.filter((n) => n.type === 'attendance.corrected' && n.params.action === 'updated'),
      ).toHaveLength(1); // the manager's change only
      const logs = await system.auditLog.findMany({ where: { entityId: created.id } });
      expect(logs.map((l) => l.action)).toEqual(['attendance.updated']);
      expect(JSON.stringify(logs)).not.toMatch(/17:00|08:30|Changed/);

      // deleting
      expect((await person.agent.delete(`/api/v1/attendance/records/${created.id}`)).status).toBe(
        204,
      );
      expect((await person.agent.delete(`/api/v1/attendance/records/${created.id}`)).status).toBe(
        404,
      );
      const second = attendanceRecordSchema.parse((await entry(person, day(ago(3)))).body);
      expect((await gus.agent.delete(`/api/v1/attendance/records/${second.id}`)).status).toBe(403);
      expect((await mia.agent.delete(`/api/v1/attendance/records/${second.id}`)).status).toBe(204);
      expect((await notesOf(person)).some((n) => n.params.action === 'deleted')).toBe(true);
    });

    it('does not let the owner change records older than 7 days, but the manager and HR can', async () => {
      const person = await onboard(acme, 'oldx');
      await manage(acme, person.employeeId, mia.employeeId);
      const old = attendanceRecordSchema.parse(
        (await entry(hr, { ...day(ago(30)), employeeId: person.employeeId })).body,
      );
      expect((await list(person, { from: ago(30), to: ago(30) })).items[0]?.canEdit).toBe(false); // seen by the owner
      const mine = await person.agent
        .patch(`/api/v1/attendance/records/${old.id}`)
        .send({ mode: 'remote' });
      expect([mine.status, errorBody(mine).code]).toEqual([403, 'FORBIDDEN']);
      expect((await person.agent.delete(`/api/v1/attendance/records/${old.id}`)).status).toBe(403);
      expect(
        (await mia.agent.patch(`/api/v1/attendance/records/${old.id}`).send({ mode: 'remote' }))
          .status,
      ).toBe(200);
      expect((await hr.agent.delete(`/api/v1/attendance/records/${old.id}`)).status).toBe(204);
    });

    it('never lets a corrector rewrite their own old records', async () => {
      const mine = attendanceRecordSchema.parse((await entry(mia, day(ago(5)))).body);
      await system.attendanceRecord.update({
        where: { id: mine.id },
        data: { workDate: new Date(`${ago(45)}T00:00:00Z`) },
      });
      const res = await mia.agent
        .patch(`/api/v1/attendance/records/${mine.id}`)
        .send({ mode: 'remote' });
      expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      expect((await mia.agent.delete(`/api/v1/attendance/records/${mine.id}`)).status).toBe(403);
    });

    it('closes open records only by checking out, but lets mode and note change', async () => {
      const person = await onboard(acme, 'openedit');
      const open = attendanceRecordSchema.parse((await checkIn(person)).body);
      const patch = (b: object) =>
        person.agent.patch(`/api/v1/attendance/records/${open.id}`).send(b);
      const times = await patch({ endTime: '17:00' });
      expect([times.status, errorBody(times).details?.[0]?.code]).toEqual([400, 'open_record']);
      expect(
        attendanceRecordSchema.parse((await patch({ mode: 'remote', note: 'Moved home' })).body),
      ).toMatchObject({ mode: 'remote', note: 'Moved home', open: true });
    });

    it('refuses edits that overlap, are empty, malformed or for unknown records', async () => {
      const person = await onboard(acme, 'editbad');
      await entry(person, day(ago(4), '09:00', '12:00'));
      const second = attendanceRecordSchema.parse(
        (await entry(person, day(ago(4), '13:00', '14:00'))).body,
      );
      const patch = (id: string, b: object) =>
        person.agent.patch(`/api/v1/attendance/records/${id}`).send(b);
      const clash = await patch(second.id, { startTime: '11:00' });
      expect([clash.status, errorBody(clash).params]).toEqual([409, { field: 'overlap' }]);
      for (const body of [
        {},
        { startTime: '9' },
        { employeeId: UNKNOWN },
        { source: 'clock' },
        { endTime: '12:00' },
      ]) {
        expect((await patch(second.id, body)).status, JSON.stringify(body)).toBe(400);
      }
      expect((await patch(UNKNOWN, { mode: 'office' })).status).toBe(404);
      expect(
        (await person.agent.patch('/api/v1/attendance/records/nope').send({ mode: 'office' }))
          .status,
      ).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('who sees which records', () => {
    let period: { from: string; to: string };
    beforeAll(async () => {
      const base = ago(40);
      period = { from: base, to: base };
      for (const who of [mia, dan, eve, gus]) {
        expect((await entry(hr, { ...day(base), employeeId: who.employeeId })).status).toBe(201);
      }
      // nobody corrects their own old records, so HR's own is inserted directly
      await insertRecord(
        hr.employeeId,
        zonedToUtc(base, '09:00', ZONE)!,
        zonedToUtc(base, '17:30', ZONE)!,
      );
    });
    const names = (l: { items: { employee: { firstName: string } }[] }) =>
      l.items.map((i) => i.employee.firstName).sort();

    it('shows employees their own, managers their subtree and HR everybody', async () => {
      expect(names(await list(gus, period))).toEqual(['gus']);
      expect(names(await list(dan, period))).toEqual(['dan']);
      expect(names(await list(mia, period))).toEqual(['dan', 'eve', 'mia']);
      expect(names(await list(hr, period))).toEqual(
        expect.arrayContaining(['dan', 'eve', 'gus', 'hrx', 'mia']),
      );
      expect(names(await list(globex.admin, period))).toEqual([]);
    });

    it('answers an employee filter outside the scope with nothing, never with their data', async () => {
      expect((await list(dan, { ...period, employeeId: eve.employeeId })).items).toEqual([]);
      expect((await list(mia, { ...period, employeeId: gus.employeeId })).items).toEqual([]);
      expect(names(await list(mia, { ...period, employeeId: eve.employeeId }))).toEqual(['eve']);
    });

    it('marks which records the caller may change', async () => {
      const seenByMia = await list(mia, period);
      expect(
        Object.fromEntries(seenByMia.items.map((i) => [i.employee.firstName, i.canEdit])),
      ).toEqual({ dan: true, eve: true, mia: false }); // her own is 40 days old
      const seenByDan = await list(dan, period);
      expect(seenByDan.items.map((i) => i.canEdit)).toEqual([false]);
    });

    it('validates the period and pages', async () => {
      for (const query of [
        {},
        { from: period.from },
        { from: addDays(period.from, 1), to: period.from },
        { from: addDays(today, -200), to: today },
        { ...period, pageSize: 201 },
      ]) {
        const res = await hr.agent.get('/api/v1/attendance/records').query(query);
        expect([res.status, errorBody(res).code], JSON.stringify(query)).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
      expect(
        (
          await hr.agent
            .get('/api/v1/attendance/records')
            .query({ from: addDays(today, -92), to: today })
        ).status,
      ).toBe(200); // 93 days
      const paged = await list(hr, { ...period, pageSize: 2, page: 2 });
      expect(paged).toMatchObject({ page: 2, pageSize: 2 });
      expect(paged.items).toHaveLength(2);
      expect(paged.total).toBeGreaterThanOrEqual(5);
      expect((await list(hr, { ...period, page: 99 })).items).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('presence today', () => {
    it('shows working, done, on leave and not recorded, inside the scope', async () => {
      const a = await onboard(acme, 'presa');
      const b = await onboard(acme, 'presb');
      const c = await onboard(acme, 'presc');
      const d = await onboard(acme, 'presd');
      for (const p of [a, b, c, d]) await manage(acme, p.employeeId, mia.employeeId);
      expect((await checkIn(a, { mode: 'remote' })).status).toBe(201);
      await insertRecord(b.employeeId, hoursAgo(3), hoursAgo(2), { mode: 'field' });
      const leaveType = (
        await system.leaveType.findFirstOrThrow({
          where: { tenantId: acme.tenantId, key: 'annual' },
        })
      ).id;
      await asTenant(acme.tenantId, async (tx) => {
        const r = await tx.leaveRequest.create({
          data: {
            employeeId: c.employeeId,
            leaveTypeId: leaveType,
            status: 'approved',
            days: 1,
            startDate: new Date(`${today}T00:00:00Z`),
            endDate: new Date(`${today}T00:00:00Z`),
          },
        });
        await tx.leaveRequestDay.create({
          data: { requestId: r.id, day: new Date(`${today}T00:00:00Z`), fraction: 1 },
        });
      });

      const res = presenceSchema.parse((await mia.agent.get('/api/v1/attendance/today')).body);
      expect(res.date).toBe(today);
      const byName = Object.fromEntries(res.items.map((i) => [i.employee.firstName, i]));
      expect(byName.presa).toMatchObject({ state: 'working', mode: 'remote' });
      expect(byName.presa?.since).toMatch(/^\d{2}:\d{2}$/);
      expect(byName.presb).toMatchObject({ state: 'done', mode: 'field', since: null });
      expect(byName.presb?.minutes).toBe(60);
      expect(byName.presc).toMatchObject({ state: 'leave', minutes: 0 });
      expect(byName.presd).toMatchObject({ state: 'none', mode: null });
      expect(byName.gus).toBeUndefined(); // not in mia's subtree
      expect(res.items.map((i) => i.employee.lastName)).toEqual(
        [...res.items.map((i) => i.employee.lastName)].sort(),
      );

      const all = presenceSchema.parse((await hr.agent.get('/api/v1/attendance/today')).body);
      expect(all.items.some((i) => i.employee.firstName === 'gus')).toBe(true);
      const mineOnly = presenceSchema.parse((await gus.agent.get('/api/v1/attendance/today')).body);
      expect(mineOnly.items.map((i) => i.employee.firstName)).toEqual(['gus']);
    });

    it('lists working before anything else when a person is both working and on leave, and leaves out inactive people', async () => {
      const person = await onboard(acme, 'presboth');
      await checkIn(person);
      const gone = await onboard(acme, 'presgone');
      await hr.agent.post(`/api/v1/employees/${gone.employeeId}/deactivate`).send({});
      const res = presenceSchema.parse((await hr.agent.get('/api/v1/attendance/today')).body);
      expect(res.items.find((i) => i.employee.firstName === 'presboth')?.state).toBe('working');
      expect(res.items.some((i) => i.employee.firstName === 'presgone')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('tenant isolation and database rules', () => {
    it('keeps another workspace away from records, in lists and in every write', async () => {
      const record = attendanceRecordSchema.parse(
        (await entry(dan, day(ago(2), '10:00', '11:00'))).body,
      );
      const g = globex.admin;
      for (const res of await Promise.all([
        g.agent.patch(`/api/v1/attendance/records/${record.id}`).send({ mode: 'remote' }),
        g.agent.delete(`/api/v1/attendance/records/${record.id}`),
      ])) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      const all = await list(g, { from: ago(30), to: today });
      expect(all.items.some((i) => i.id === record.id)).toBe(false);
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.attendanceRecord.findUnique({ where: { id: record.id } }),
        ),
      ).toBeNull();
      expect(
        await asTenant(globex.tenantId, (tx) =>
          tx.attendanceRecord.deleteMany({ where: { id: record.id } }),
        ),
      ).toEqual({ count: 0 });
      await expect(
        asTenant(globex.tenantId, (tx) =>
          tx.attendanceRecord.create({
            data: {
              tenantId: acme.tenantId,
              employeeId: dan.employeeId,
              workDate: new Date(),
              checkInAt: new Date(),
              mode: 'office',
            },
          }),
        ),
      ).rejects.toThrow();
      const foreign = await system.employee.findFirstOrThrow({
        where: { tenantId: globex.tenantId },
      });
      await expect(
        system.attendanceRecord.create({
          data: {
            tenantId: acme.tenantId,
            employeeId: foreign.id,
            workDate: new Date(),
            checkInAt: new Date(),
            mode: 'office',
          },
        }),
      ).rejects.toThrow();
    });

    it('enforces the rules in the database when the application is bypassed', async () => {
      const person = await onboard(acme, 'dbrules');
      const base = {
        tenantId: acme.tenantId,
        employeeId: person.employeeId,
        workDate: new Date(`${ago(9)}T00:00:00Z`),
        mode: 'office',
      };
      const t0 = new Date(`${ago(9)}T08:00:00Z`);
      const plus = (h: number) => new Date(t0.getTime() + h * 3_600_000);
      await system.attendanceRecord.create({
        data: { ...base, checkInAt: t0, checkOutAt: plus(4) },
      });
      const refuse = (data: object) =>
        expect(
          system.attendanceRecord.create({ data: { ...base, ...data } as never }),
        ).rejects.toThrow();
      await refuse({ checkInAt: plus(2), checkOutAt: plus(6) }); // overlap
      await refuse({ checkInAt: plus(-1), checkOutAt: plus(1) }); // overlap
      await refuse({ checkInAt: plus(10), checkOutAt: plus(10) }); // no duration
      await refuse({ checkInAt: plus(10), checkOutAt: plus(9) }); // backwards
      await refuse({ checkInAt: plus(10), checkOutAt: plus(27) }); // 17 hours
      await refuse({ checkInAt: plus(10), checkOutAt: plus(11), mode: 'moon' });
      await refuse({ checkInAt: plus(10), checkOutAt: plus(11), source: 'robot' });
      await refuse({ checkInAt: plus(10), checkOutAt: plus(11), note: 'x'.repeat(201) });
      await expect(
        system.attendanceRecord.create({
          data: { ...base, checkInAt: plus(5), checkOutAt: plus(21) },
        }),
      ).resolves.toBeTruthy(); // exactly 16 hours
      await system.attendanceRecord.create({ data: { ...base, checkInAt: plus(30) } }); // one open record
      await refuse({ checkInAt: plus(40) }); // a second open one
      await refuse({ checkInAt: plus(31), checkOutAt: plus(32) }); // inside the open one
    });

    it('lets the application role delete only through its row policies, and nothing without a tenant', async () => {
      await expect(
        asTenant(acme.tenantId, (tx) => tx.$executeRaw`UPDATE attendance_record SET mode = 'x'`),
      ).rejects.toThrow();
      expect(await asTenant(globex.tenantId, (tx) => tx.attendanceRecord.count())).toBe(0);
    });
  });
});
