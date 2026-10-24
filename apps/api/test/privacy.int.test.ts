import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  employeeSchema,
  personalDataExportSchema,
  todayIn,
  type SystemRole,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { ErasureService } from '../src/modules/privacy/erasure.service.js';
import { OutboxWorker } from '../src/modules/notifications/delivery/outbox-worker.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;
const UNKNOWN = '0192f5a0-0000-7000-8000-00000000000a';
const ZONE = 'Europe/Sofia';

describe.skipIf(!urls)('privacy: export and erasure over HTTP (real database)', () => {
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
  let eve: Person; // bystander
  let dan: Person; // the subject
  let gwen: Person; // a person of another workspace with the same kind of data

  const today = todayIn(ZONE);
  const monday = (() => {
    let d = addDays(today, 30);
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
    return d;
  })();
  const DAN_SECRETS = [
    'dan@acme.eu',
    '+359881234567',
    '1990-05-17',
    'Dentist for Dan',
    'Hospital Alpha',
    'Family trip',
  ];

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

  const exportOwn = (who: Member) => who.agent.get('/api/v1/privacy/export');
  const exportOf = (who: Member, id: string) => who.agent.get(`/api/v1/privacy/export/${id}`);
  const erase = (who: Member, id: string, body: object = { confirm: true }) =>
    who.agent.post(`/api/v1/privacy/erase/${id}`).send(body);
  const notesOf = async (who: Member) => {
    await app.get(OutboxWorker).runOnce();
    return (await who.agent.get('/api/v1/notifications')).body.items as {
      type: string;
      params: Record<string, unknown>;
    }[];
  };

  /** A person with a profile, attendance with a note, a personal event and leave with reasons and comments. */
  async function fillWith(
    who: Person,
    ws: Workspace,
    secrets: { note: string; event: string; reason: string },
  ) {
    const human = ws === acme ? hr : gwen;
    const patch = await human.agent.patch(`/api/v1/employees/${who.employeeId}`).send({
      phone: '+359881234567',
      birthDate: '1990-05-17',
      jobTitle: 'Developer',
      location: 'Sofia',
    });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    const attendance = await who.agent.post('/api/v1/attendance/records').send({
      date: addDays(today, -1),
      startTime: '09:00',
      endTime: '17:00',
      mode: 'office',
      note: secrets.note,
    });
    expect(attendance.status).toBe(201);
    const event = await who.agent.post('/api/v1/calendar/events').send({
      scope: 'personal',
      title: secrets.event,
      allDay: true,
      startDate: addDays(today, 2),
      endDate: addDays(today, 2),
    });
    expect(event.status).toBe(201);
    const types = (await who.agent.get('/api/v1/leave/types')).body as {
      id: string;
      key: string | null;
    }[];
    const annual = types.find((t) => t.key === 'annual')!;
    const sick = types.find((t) => t.key === 'sick')!;
    const request = await who.agent.post('/api/v1/leave/requests').send({
      leaveTypeId: annual.id,
      startDate: monday,
      endDate: addDays(monday, 1),
      reason: secrets.reason,
    });
    expect(request.status, JSON.stringify(request.body)).toBe(201);
    const sickDays = await who.agent.post('/api/v1/leave/requests').send({
      leaveTypeId: sick.id,
      startDate: addDays(monday, 7),
      endDate: addDays(monday, 7),
    });
    expect(sickDays.status).toBe(201);
    return request.body.id as string;
  }

  let danRequest: string;
  let gwenRequest: string;

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    hr = await onboard(acme, 'hrx', 'hr');
    mia = await onboard(acme, 'mia', 'manager');
    eve = await onboard(acme, 'eve');
    dan = await onboard(acme, 'dan');
    gwen = await onboard(globex, 'gwen', 'hr');
    const manage = await acme.admin.agent
      .put(`/api/v1/org/employees/${dan.employeeId}/assignment`)
      .send({ managerId: mia.employeeId, departmentId: null });
    expect(manage.status).toBe(204);
    await eve.agent.post('/api/v1/attendance/records').send({
      date: addDays(today, -1),
      startTime: '09:00',
      endTime: '10:00',
      mode: 'office',
      note: 'Eve keeps this note',
    });
    danRequest = await fillWith(dan, acme, {
      note: 'Hospital Alpha',
      event: 'Dentist for Dan',
      reason: 'Family trip',
    });
    expect(
      (
        await mia.agent
          .post(`/api/v1/leave/requests/${danRequest}/approve`)
          .send({ comment: 'Enjoy, Dan!' })
      ).status,
    ).toBe(200);
    gwenRequest = await fillWith(gwen, globex, {
      note: 'Hospital Alpha',
      event: 'Dentist for Dan',
      reason: 'Family trip',
    });
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe('export', () => {
    it('gives people everything held about them, as a download, without secrets', async () => {
      await app.get(OutboxWorker).runOnce(); // turn the queued events into notifications
      const res = await exportOwn(dan);
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="intime-data-export.json"',
      );
      expect(res.headers['cache-control']).toBe('no-store');
      const doc = personalDataExportSchema.parse(JSON.parse(res.text));
      expect(doc.account).toMatchObject({ email: 'dan@acme.eu', roles: ['Employee'] });
      expect(doc.employee).toMatchObject({
        firstName: 'dan',
        phone: '+359881234567',
        birthDate: '1990-05-17',
        jobTitle: 'Developer',
        manager: 'mia Test',
      });
      expect(doc.attendance).toHaveLength(1);
      expect(doc.attendance[0]).toMatchObject({
        note: 'Hospital Alpha',
        mode: 'office',
        source: 'entry',
      });
      expect(doc.calendarEvents.map((e) => e.title)).toEqual(['Dentist for Dan']);
      expect(doc.leave.requests).toHaveLength(2);
      expect(doc.leave.requests[0]).toMatchObject({
        type: 'annual',
        reason: 'Family trip',
        decisionComments: ['Enjoy, Dan!'],
      });
      expect(doc.leave.requests[1]?.type).toBe('sick'); // a person sees their own sick leave type
      expect(doc.leave.balances.length).toBeGreaterThan(0);
      expect(doc.notifications.map((n) => n.type)).toContain('leave.decided');
      const recorded = await system.auditLog.count({ where: { actorUserId: dan.id } });
      expect(doc.auditEntries).toHaveLength(recorded); // what Dan caused (e.g. accepting the invitation), nothing more
      expect(res.text).not.toMatch(/passwordHash|tokenHash|argon2|refresh/i);
    });

    it('contains only the caller’s own data', async () => {
      const doc = personalDataExportSchema.parse((await exportOwn(eve)).body);
      expect(doc.employee?.firstName).toBe('eve');
      expect(JSON.stringify(doc)).not.toContain('Hospital Alpha');
      expect(doc.attendance.map((a) => a.note)).toEqual(['Eve keeps this note']);
    });

    it('lists what an administrator did, by action and time only', async () => {
      const doc = personalDataExportSchema.parse((await exportOwn(hr)).body);
      expect(doc.auditEntries.length).toBeGreaterThan(0);
      expect(Object.keys(doc.auditEntries[0]!).sort()).toEqual(['action', 'at', 'entity']);
    });

    it('needs a signed-in user', async () => {
      const anonymous = await (
        await import('supertest')
      )
        .default(app.getHttpServer())
        .get('/api/v1/privacy/export');
      expect(anonymous.status).toBe(401);
    });

    it('lets HR export an employee, audited with ids only, and nobody else', async () => {
      const before = await system.auditLog.count({
        where: { tenantId: acme.tenantId, action: 'privacy.exported' },
      });
      const res = await exportOf(hr, dan.employeeId);
      expect(res.status).toBe(200);
      expect(personalDataExportSchema.parse(res.body).employee?.phone).toBe('+359881234567');
      const logs = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: 'privacy.exported' },
      });
      expect(logs).toHaveLength(before + 1);
      expect(logs.at(-1)).toMatchObject({
        entityId: dan.employeeId,
        entity: 'employee',
        before: null,
        after: null,
      });
      expect((await exportOf(acme.admin, dan.employeeId)).status).toBe(200);
      for (const who of [dan, mia, eve]) {
        const denied = await exportOf(who, dan.employeeId);
        expect([denied.status, errorBody(denied).code]).toEqual([403, 'FORBIDDEN']);
      }
      expect(
        await system.auditLog.count({
          where: { tenantId: acme.tenantId, action: 'privacy.exported' },
        }),
      ).toBe(before + 2);
    });

    it('does not audit own exports, and refuses unknown, malformed and foreign ids', async () => {
      const before = await system.auditLog.count({
        where: { tenantId: acme.tenantId, action: 'privacy.exported' },
      });
      await exportOwn(dan);
      expect(
        await system.auditLog.count({
          where: { tenantId: acme.tenantId, action: 'privacy.exported' },
        }),
      ).toBe(before);
      expect((await exportOf(hr, UNKNOWN)).status).toBe(404);
      expect((await hr.agent.get('/api/v1/privacy/export/nope')).status).toBe(400);
      const foreign = await exportOf(gwen, dan.employeeId); // another workspace's HR
      expect([foreign.status, errorBody(foreign).code]).toEqual([404, 'NOT_FOUND']);
      expect(JSON.stringify(foreign.body)).not.toContain('Hospital Alpha');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('erasure', () => {
    it('refuses people without the permission, bad bodies and unknown or foreign employees', async () => {
      for (const who of [dan, mia, eve]) {
        const res = await erase(who, dan.employeeId);
        expect([res.status, errorBody(res).code]).toEqual([403, 'FORBIDDEN']);
      }
      for (const body of [
        {},
        { confirm: false },
        { confirm: 'yes' },
        { confirm: true, extra: 1 },
      ]) {
        const res = await erase(hr, dan.employeeId, body);
        expect([res.status, errorBody(res).code], JSON.stringify(body)).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
      expect((await erase(hr, UNKNOWN)).status).toBe(404);
      const foreign = await erase(gwen, dan.employeeId);
      expect([foreign.status, errorBody(foreign).code]).toEqual([404, 'NOT_FOUND']);
      expect(
        (await hr.agent.post('/api/v1/privacy/erase/nope').send({ confirm: true })).status,
      ).toBe(400);
      const row = await system.employee.findUniqueOrThrow({ where: { id: dan.employeeId } });
      expect([row.firstName, row.phone, row.erasedAt]).toEqual(['dan', '+359881234567', null]);
    });

    it('refuses an employee who is still active, until they are deactivated', async () => {
      const res = await erase(hr, dan.employeeId);
      expect([res.status, errorBody(res).params]).toEqual([409, { field: 'active' }]);
      const row = await system.employee.findUniqueOrThrow({ where: { id: dan.employeeId } });
      expect(row.erasedAt).toBeNull();
    });

    it('anonymises a former employee and keeps only what the law requires', async () => {
      // Dan has notifications from before (a decision on their leave); Mia has one naming Dan.
      expect((await notesOf(mia)).some((n) => n.params.employeeName === 'dan Test')).toBe(true);
      expect((await notesOf(dan)).length).toBeGreaterThan(0);
      expect(
        (
          await hr.agent
            .post(`/api/v1/employees/${dan.employeeId}/deactivate`)
            .send({ terminationDate: today })
        ).status,
      ).toBe(200);

      const res = await erase(hr, dan.employeeId);
      expect(res.status, JSON.stringify(res.body)).toBe(204);

      // the employee record
      const employee = await system.employee.findUniqueOrThrow({ where: { id: dan.employeeId } });
      expect(employee).toMatchObject({
        firstName: '—',
        lastName: `#${dan.employeeId.slice(-6)}`,
        employeeNo: null,
        jobTitle: null,
        location: null,
        seniority: null,
        birthDate: null,
        phone: null,
        country: null,
        departmentId: null,
        managerId: null,
        status: 'inactive',
        employmentType: 'full_time',
      });
      expect(employee.erasedAt).toBeInstanceOf(Date);
      expect(employee.terminationDate).not.toBeNull(); // statutory dates stay

      // the account
      const user = await system.user.findFirstOrThrow({ where: { id: employee.userId! } });
      expect(user).toMatchObject({
        email: `erased-${user.id}@invalid`,
        status: 'disabled',
        locale: null,
        timezone: null,
        lastLoginAt: null,
      });
      for (const count of await Promise.all([
        system.session.count({ where: { userId: user.id } }),
        system.refreshToken.count({ where: { session: { userId: user.id } } }),
        system.authToken.count({ where: { userId: user.id } }),
        system.authIdentity.count({ where: { userId: user.id } }),
        system.userRole.count({ where: { userId: user.id } }),
        system.notification.count({ where: { recipientUserId: user.id } }),
        system.notificationPreference.count({ where: { userId: user.id } }),
        system.calendarEvent.count({ where: { ownerEmployeeId: dan.employeeId } }),
        system.teamMember.count({ where: { employeeId: dan.employeeId } }),
      ])) {
        expect(count).toBe(0);
      }
      expect((await dan.agent.get('/api/v1/employees/me')).status).toBe(401); // the session is gone

      // records the law keeps, without free text
      const attendance = await system.attendanceRecord.findMany({
        where: { employeeId: dan.employeeId },
      });
      expect(attendance).toHaveLength(1);
      expect(attendance[0]?.note).toBeNull();
      const requests = await system.leaveRequest.findMany({
        where: { employeeId: dan.employeeId },
      });
      expect(requests).toHaveLength(2);
      expect(requests.every((r) => r.reason === null)).toBe(true);
      expect(requests.map((r) => r.status).sort()).toEqual(['approved', 'approved']);
      expect(
        await system.leaveApproval.count({
          where: { request: { employeeId: dan.employeeId }, comment: { not: null } },
        }),
      ).toBe(0);
      expect(
        await system.leaveBalance.count({ where: { employeeId: dan.employeeId } }),
      ).toBeGreaterThan(0);

      // other people's notifications no longer carry the name
      const mias = await notesOf(mia);
      expect(JSON.stringify(mias)).not.toContain('dan Test');
      expect(mias.some((n) => n.params.employeeName === '—')).toBe(true);
      expect(
        await system.outboxEvent.count({
          where: {
            tenantId: acme.tenantId,
            params: { path: ['employeeName'], equals: 'dan Test' },
          },
        }),
      ).toBe(0);

      // nothing of Dan is left anywhere in the workspace's rows we know hold text
      const everything = JSON.stringify({
        employees: await system.employee.findMany({
          where: { tenantId: acme.tenantId, id: dan.employeeId },
        }),
        users: await system.user.findMany({ where: { id: user.id } }),
        attendance,
        requests,
        approvals: await system.leaveApproval.findMany({ where: { tenantId: acme.tenantId } }),
        notifications: await system.notification.findMany({ where: { tenantId: acme.tenantId } }),
        outbox: await system.outboxEvent.findMany({ where: { tenantId: acme.tenantId } }),
        audit: await system.auditLog.findMany({ where: { tenantId: acme.tenantId } }),
      });
      for (const secret of DAN_SECRETS) expect(everything, secret).not.toContain(secret);
      expect(everything).not.toContain('Enjoy, Dan!');
      expect(everything).not.toContain('dan Test');

      // the audit trail records the erasure with ids only
      const logs = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: 'privacy.erased' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        entityId: dan.employeeId,
        actorUserId: hr.id,
        before: null,
        after: null,
      });
    });

    it('shows the erased person as a placeholder, and an export holds nothing personal', async () => {
      const list = await hr.agent.get('/api/v1/employees').query({ status: 'inactive' });
      expect(list.status).toBe(200);
      const found = (list.body.items as { id: string; firstName: string; lastName: string }[]).find(
        (e) => e.id === dan.employeeId,
      );
      expect(found).toMatchObject({ firstName: '—', erased: true, email: null });
      // an erased record is final: it cannot be edited or brought back
      for (const res of [
        await hr.agent
          .patch(`/api/v1/employees/${dan.employeeId}`)
          .send({ jobTitle: 'Back again' }),
        await hr.agent.post(`/api/v1/employees/${dan.employeeId}/reactivate`).send({}),
      ]) {
        expect([res.status, errorBody(res).params]).toEqual([409, { field: 'erased' }]);
      }
      expect(
        (await system.employee.findUniqueOrThrow({ where: { id: dan.employeeId } })).status,
      ).toBe('inactive');
      const doc = personalDataExportSchema.parse((await exportOf(hr, dan.employeeId)).body);
      expect(doc.employee).toMatchObject({
        firstName: '—',
        phone: null,
        birthDate: null,
        jobTitle: null,
      });
      expect(doc.account).toMatchObject({ status: 'disabled', roles: [] });
      expect(doc.calendarEvents).toEqual([]);
      expect(
        doc.leave.requests.every((r) => r.reason === null && r.decisionComments.length === 0),
      ).toBe(true);
      expect(JSON.stringify(doc)).not.toContain('Hospital Alpha');
    });

    it('cannot be repeated', async () => {
      const again = await erase(hr, dan.employeeId);
      expect([again.status, errorBody(again).params]).toEqual([409, { field: 'erased' }]);
      expect(
        await system.auditLog.count({
          where: { tenantId: acme.tenantId, action: 'privacy.erased' },
        }),
      ).toBe(1);
    });

    it('leaves everybody else untouched, in this and in other workspaces', async () => {
      const eveDoc = personalDataExportSchema.parse((await exportOwn(eve)).body);
      expect(eveDoc.attendance[0]?.note).toBe('Eve keeps this note');
      expect((await exportOwn(mia)).status).toBe(200);
      const g = await system.employee.findUniqueOrThrow({ where: { id: gwen.employeeId } });
      expect([g.firstName, g.phone, g.erasedAt]).toEqual(['gwen', '+359881234567', null]);
      expect(
        (await system.attendanceRecord.findFirstOrThrow({ where: { employeeId: gwen.employeeId } }))
          .note,
      ).toBe('Hospital Alpha');
      expect(
        (await system.leaveRequest.findUniqueOrThrow({ where: { id: gwenRequest } })).reason,
      ).toBe('Family trip');
      expect(
        await system.calendarEvent.count({ where: { ownerEmployeeId: gwen.employeeId } }),
      ).toBe(1);
      expect((await gwen.agent.get('/api/v1/employees/me')).status).toBe(200);
    });

    it('does not let somebody erase themselves (checked at the service: an inactive account cannot sign in)', async () => {
      const leaver = await onboard(acme, 'leaver', 'hr');
      expect(
        (await acme.admin.agent.post(`/api/v1/employees/${leaver.employeeId}/deactivate`).send({}))
          .status,
      ).toBe(200);
      await expect(
        app.get(ErasureService).erase(acme.tenantId, leaver.id, leaver.employeeId),
      ).rejects.toMatchObject({ params: { field: 'self' } });
      expect(
        (await system.employee.findUniqueOrThrow({ where: { id: leaver.employeeId } })).erasedAt,
      ).toBeNull();
    });
  });
});
