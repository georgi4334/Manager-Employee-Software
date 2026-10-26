import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  DEFAULT_WEEK,
  MAX_SCHEDULE_ROWS,
  addDays,
  apiErrorBodySchema,
  capacitySchema,
  employeeSchema,
  projectDetailSchema,
  todayIn,
  weekStartOf,
  workSchedulesSchema,
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
const PART_TIME = [240, 240, 240, 240, 0, 480, 0];

describe.skipIf(!urls)('working hours over HTTP (real database)', () => {
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
  let mia: Person; // manager of dan and pat
  let dan: Person;
  let eve: Person; // not in Mia's team
  let pat: Person; // part-time, for the capacity numbers
  let globexEmployee: string;

  const today = todayIn(ZONE);
  const mon = addDays(weekStartOf(today), -14);
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
  const url = (who: Person, tail = '') => `${api}/employees/${who.employeeId}/schedule${tail}`;
  const get = async (as: Member, who: Person) => {
    const res = await as.agent.get(url(who));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return workSchedulesSchema.parse(res.body);
  };
  const put = (as: Member, who: Person, body: object) => as.agent.put(url(who)).send(body);
  const week = (minutes = PART_TIME, validFrom = day(0)) => ({ validFrom, minutes });

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
    pat = await onboard(acme, 'pat');
    for (const who of [dan, pat]) {
      const res = await acme.admin.agent
        .put(`${api}/org/employees/${who.employeeId}/assignment`)
        .send({ managerId: mia.employeeId, departmentId: null });
      expect(res.status).toBe(204);
    }
    globexEmployee = (await onboard(globex, 'gina')).employeeId;
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  describe('reading', () => {
    it('is the default week until something is set', async () => {
      const s = await get(dan, dan);
      expect(s).toMatchObject({ isDefault: true, items: [], canManage: false });
      expect(s.effective).toEqual([...DEFAULT_WEEK]);
    });

    it.each([
      ['themselves', () => dan],
      ['their manager', () => mia],
      ['HR', () => hr],
      ['an administrator', () => ({ ...acme.admin, employeeId: dan.employeeId })],
    ])('is readable by %s', async (_name, who) => {
      const res = await who().agent.get(url(dan));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it('is 404 for a colleague outside the scope, an unknown person and another workspace', async () => {
      expect((await eve.agent.get(url(dan))).status).toBe(404);
      expect((await mia.agent.get(url(eve))).status).toBe(404); // not in Mia's team
      expect((await dan.agent.get(`${api}/employees/${UNKNOWN}/schedule`)).status).toBe(404);
      expect((await globex.admin.agent.get(url(dan))).status).toBe(404);
      expect(
        (await acme.admin.agent.get(`${api}/employees/${globexEmployee}/schedule`)).status,
      ).toBe(404);
      expect((await dan.agent.get(`${api}/employees/nope/schedule`)).status).toBe(400);
    });

    it('needs a signed-in user', async () => {
      const anon = await (await import('supertest')).default(app.getHttpServer()).get(url(dan));
      expect(anon.status).toBe(401);
    });
  });

  describe('changing', () => {
    it('is for HR and administrators only, not for the person, their manager or colleagues', async () => {
      for (const who of [dan, mia, eve]) {
        const res = await put(who, dan, week());
        expect(res.status).toBe(403);
        expect(errorBody(res).code).toBe('FORBIDDEN');
      }
      expect((await dan.agent.delete(url(dan, `/${UNKNOWN}`))).status).toBe(403);
      expect(await system.workSchedule.count({ where: { tenantId: acme.tenantId } })).toBe(0);
    });

    it('stores a schedule, marks it as in force and audits ids and the date only', async () => {
      const res = await put(hr, dan, week());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const s = workSchedulesSchema.parse(res.body);
      expect(s).toMatchObject({ isDefault: false, canManage: true });
      expect(s.effective).toEqual(PART_TIME);
      expect(s.items).toHaveLength(1);
      expect(s.items[0]).toMatchObject({ validFrom: day(0), minutes: PART_TIME, current: true });

      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: 'employee.schedule_set' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.after).toEqual({ employeeId: dan.employeeId, validFrom: day(0) });
      expect(JSON.stringify(entries)).not.toContain('240');

      // the person and their manager see it too
      expect((await get(dan, dan)).effective).toEqual(PART_TIME);
      expect((await get(mia, dan)).effective).toEqual(PART_TIME);
    });

    it('replaces the schedule of the same date instead of adding a second one', async () => {
      const full = [480, 480, 480, 480, 480, 0, 0];
      const s = workSchedulesSchema.parse((await put(hr, dan, week(full))).body);
      expect(s.items).toHaveLength(1);
      expect(s.effective).toEqual(full);
      await put(hr, dan, week());
    });

    it('keeps upcoming changes apart from the one in force, newest first', async () => {
      const future = addDays(today, 30);
      const s = workSchedulesSchema.parse(
        (await put(hr, dan, week([480, 480, 480, 480, 480, 0, 0], future))).body,
      );
      expect(s.items.map((i) => [i.validFrom, i.current])).toEqual([
        [future, false],
        [day(0), true],
      ]);
      expect(s.effective).toEqual(PART_TIME); // the future change is not in force yet
    });

    it.each([
      ['six days', { minutes: [480, 480, 480, 480, 480, 0] }],
      ['eight days', { minutes: [480, 480, 480, 480, 480, 0, 0, 0] }],
      ['a negative day', { minutes: [-1, 0, 0, 0, 0, 0, 0] }],
      ['more than 16 hours', { minutes: [961, 0, 0, 0, 0, 0, 0] }],
      ['half minutes', { minutes: [0.5, 0, 0, 0, 0, 0, 0] }],
      ['text instead of minutes', { minutes: ['8:00', 0, 0, 0, 0, 0, 0] }],
      ['a bad date', { validFrom: '2026-13-40' }],
      ['no date', { validFrom: undefined }],
      ['an unknown field', { employeeId: UNKNOWN }],
    ])('refuses %s', async (_name, change) => {
      const res = await put(hr, dan, { ...week(), ...change });
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    });

    it('accepts the limits: all zero and 16 hours', async () => {
      expect((await put(hr, eve, week([0, 0, 0, 0, 0, 0, 0], day(1)))).status).toBe(200);
      expect((await put(hr, eve, week([960, 960, 960, 960, 960, 960, 960], day(2)))).status).toBe(
        200,
      );
      await system.workSchedule.deleteMany({
        where: { tenantId: acme.tenantId, employeeId: eve.employeeId },
      });
    });

    it('is 404 for an unknown employee and for another workspace, in both directions', async () => {
      expect((await hr.agent.put(`${api}/employees/${UNKNOWN}/schedule`).send(week())).status).toBe(
        404,
      );
      expect(
        (await hr.agent.put(`${api}/employees/${globexEmployee}/schedule`).send(week())).status,
      ).toBe(404);
      expect((await globex.admin.agent.put(url(dan)).send(week())).status).toBe(404);
      expect(await system.workSchedule.count({ where: { tenantId: globex.tenantId } })).toBe(0);
    });

    it('stops at the maximum number of changes per person', async () => {
      await system.workSchedule.createMany({
        data: Array.from({ length: MAX_SCHEDULE_ROWS }, (_, i) => ({
          tenantId: acme.tenantId,
          employeeId: pat.employeeId,
          validFrom: new Date(Date.UTC(2010, 0, 1 + i)),
          minutes: PART_TIME,
        })),
      });
      const res = await put(hr, pat, week(PART_TIME, day(3)));
      expect(res.status).toBe(409);
      expect(errorBody(res).params).toEqual({ field: 'limit' });
      // replacing the schedule of an existing date is still fine
      const same = await put(hr, pat, week([1, 2, 3, 4, 5, 6, 7], '2010-01-01'));
      expect(same.status).toBe(200);
      await system.workSchedule.deleteMany({
        where: { tenantId: acme.tenantId, employeeId: pat.employeeId },
      });
    });

    it('is checked by the database too: seven values between 0 and 960', async () => {
      for (const minutes of [
        [1, 2, 3],
        [961, 0, 0, 0, 0, 0, 0],
        [-1, 0, 0, 0, 0, 0, 0],
      ]) {
        await expect(
          system.workSchedule.create({
            data: {
              tenantId: acme.tenantId,
              employeeId: eve.employeeId,
              validFrom: new Date('2026-01-05T00:00:00Z'),
              minutes,
            },
          }),
        ).rejects.toThrow();
      }
    });
  });

  describe('removing', () => {
    it('removes one change and falls back to the default week', async () => {
      const before = await get(hr, eve);
      expect(before.isDefault).toBe(true);
      const created = workSchedulesSchema.parse((await put(hr, eve, week())).body);
      const id = created.items[0]!.id;
      const res = await hr.agent.delete(url(eve, `/${id}`));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(workSchedulesSchema.parse(res.body)).toMatchObject({ isDefault: true, items: [] });
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: 'employee.schedule_removed' },
      });
      expect(entries.at(-1)?.after).toEqual({ employeeId: eve.employeeId, validFrom: day(0) });
    });

    it('is 404 for an unknown change, one of another person and another workspace', async () => {
      const danRow = (await get(hr, dan)).items[0]!;
      expect((await hr.agent.delete(url(eve, `/${UNKNOWN}`))).status).toBe(404);
      expect((await hr.agent.delete(url(eve, `/${danRow.id}`))).status).toBe(404); // Dan's row via Eve's URL
      expect((await globex.admin.agent.delete(url(dan, `/${danRow.id}`))).status).toBe(404);
      expect((await get(hr, dan)).items.some((i) => i.id === danRow.id)).toBe(true);
    });
  });

  describe('capacity uses it', () => {
    let project: string;
    beforeAll(async () => {
      // Pat works Monday to Thursday 4 hours and Saturday 8 hours, since Monday two weeks ago
      expect((await put(hr, pat, week())).status).toBe(200);
      const created = await hr.agent.post(`${api}/projects`).send({
        code: 'WH001',
        name: 'Alpha',
        startDate: addDays(today, -400),
        status: 'active',
        leadEmployeeId: hr.employeeId,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      project = projectDetailSchema.parse(created.body).id;
      const staffed = await hr.agent.post(`${api}/projects/${project}/assignments`).send({
        employeeId: pat.employeeId,
        allocationPct: 50,
        fromDate: addDays(today, -400),
      });
      expect(staffed.status, JSON.stringify(staffed.body)).toBe(201);

      // half a day off on Monday (approved by HR)
      const types = (await pat.agent.get(`${api}/leave/types`)).body as {
        id: string;
        key: string;
      }[];
      const leave = await pat.agent.post(`${api}/leave/requests`).send({
        leaveTypeId: types.find((t) => t.key === 'unpaid')!.id,
        startDate: day(0),
        endDate: day(0),
        halfDayStart: true,
      });
      expect(leave.status, JSON.stringify(leave.body)).toBe(201);
      const approved = await hr.agent
        .post(`${api}/leave/requests/${(leave.body as { id: string }).id}/approve`)
        .send({});
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);

      // 5 hours on Monday (2 hours available), 90 minutes on Friday (a day off)
      for (const [date, minutes] of [
        [day(0), 300],
        [day(4), 90],
      ] as const) {
        const res = await pat.agent
          .post(`${api}/time/entries`)
          .send({ projectId: project, workDate: date, minutes });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
      }
    });

    const overview = async (as: Member) => {
      const res = await as.agent
        .get(`${api}/capacity`)
        .query({ from: day(0), to: day(6), q: 'pat' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return capacitySchema.parse(res.body).items.find((i) => i.employee.id === pat.employeeId)!;
    };

    it('measures a person against their own hours, including a working Saturday', async () => {
      const p = await overview(hr);
      expect(p.days.map((d) => [d.date, d.availableMinutes])).toEqual([
        [day(0), 120], // 4 h minus half of the 4 h day
        [day(1), 240],
        [day(2), 240],
        [day(3), 240],
        [day(4), 0], // Friday is off
        [day(5), 480], // Saturday is a working day
        [day(6), 0],
      ]);
      expect(p.availableMinutes).toBe(1320);
      expect(p.plannedMinutes).toBe(660); // 50 % of the available time
      expect(p.days[5]?.status).toBe('busy');
      expect(p.days[4]?.status).toBe('off');
    });

    it('reports overtime: time beyond the available time, and all time on a day off', async () => {
      const p = await overview(hr);
      expect(p.loggedMinutes).toBe(390);
      expect(p.overtimeMinutes).toBe(300 - 120 + 90);
    });

    it('shows the same numbers to the manager and the person, and nothing for others', async () => {
      expect((await overview(mia)).overtimeMinutes).toBe(270);
      expect((await overview(pat)).availableMinutes).toBe(1320);
      const res = await eve.agent
        .get(`${api}/capacity`)
        .query({ from: day(0), to: day(6), q: 'pat' });
      expect(capacitySchema.parse(res.body).items).toHaveLength(0);
    });

    it('a person without a schedule keeps the standard week and has no overtime', async () => {
      const res = await hr.agent
        .get(`${api}/capacity`)
        .query({ from: day(0), to: day(6), q: 'eve' });
      const e = capacitySchema.parse(res.body).items[0]!;
      expect(e.availableMinutes).toBe(2400);
      expect(e.overtimeMinutes).toBe(0);
    });

    it('a change from a later date does not rewrite the weeks before it', async () => {
      await put(hr, pat, week([480, 480, 480, 480, 480, 0, 0], addDays(day(0), 7)));
      expect((await overview(hr)).availableMinutes).toBe(1320); // the first week is unchanged
      const later = await hr.agent
        .get(`${api}/capacity`)
        .query({ from: day(7), to: day(13), q: 'pat' });
      expect(capacitySchema.parse(later.body).items[0]?.availableMinutes).toBe(2400);
    });
  });
});
