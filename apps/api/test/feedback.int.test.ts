import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  employeeSchema,
  feedbackItemSchema,
  feedbackListSchema,
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

describe.skipIf(!urls)('feedback over HTTP (real database)', () => {
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
  let hr: Person; // moderator, reads what is shared with managers
  let mia: Person; // manager of dan and eve
  let ron: Person; // manager without reports
  let dan: Person;
  let eve: Person;
  let gus: Person; // no manager
  let admin: Person; // the workspace administrator, a moderator without a view on received feedback
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
  const give = (who: Member, to: Person | string, body: object = {}) =>
    who.agent.post(`${api}/feedback`).send({
      toEmployeeId: typeof to === 'string' ? to : to.employeeId,
      kind: 'praise',
      body: 'Great work on the release',
      ...body,
    });
  const gave = async (who: Member, to: Person, body: object = {}) => {
    const res = await give(who, to, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return feedbackItemSchema.parse(res.body);
  };
  const box = (who: Member, query: object = {}) =>
    who.agent.get(`${api}/feedback`).query({ pageSize: 100, ...query });
  const listOf = async (who: Member, query: object = {}) => {
    const res = await box(who, query);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return feedbackListSchema.parse(res.body);
  };
  const ids = async (who: Member, query: object = {}) =>
    (await listOf(who, query)).items.map((f) => f.id);
  const del = (who: Member, id: string) => who.agent.delete(`${api}/feedback/${id}`);
  const report = (who: Member, id: string) => who.agent.post(`${api}/feedback/${id}/report`);
  const keep = (who: Member, id: string) => who.agent.post(`${api}/feedback/${id}/keep`);
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
    const adminEmployee = await system.employee.findFirstOrThrow({
      where: { tenantId: acme.tenantId, userId: acme.admin.id },
    });
    admin = { ...acme.admin, employeeId: adminEmployee.id };
    for (const who of [dan, eve]) {
      const res = await acme.admin.agent
        .put(`${api}/org/employees/${who.employeeId}/assignment`)
        .send({ managerId: mia.employeeId, departmentId: null });
      expect(res.status).toBe(204);
    }
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe('giving feedback', () => {
    it('lets any colleague give any other feedback, private to the recipient by default', async () => {
      const f = await gave(dan, eve, { body: ' Thanks for the help ' });
      expect(f).toMatchObject({
        from: { id: dan.employeeId },
        to: { id: eve.employeeId },
        kind: 'praise',
        visibility: 'recipient',
        body: 'Thanks for the help',
        report: 'none',
        canReport: false,
        canRemove: true,
        canKeep: false,
      });
      // everybody may give: also across the line of management, HR, managers and the administrator
      for (const who of [hr, mia, gus, ron, admin]) {
        expect((await give(who, dan)).status, who.email).toBe(201);
      }
      expect(
        (await give(dan, mia, { kind: 'constructive', visibility: 'recipient_and_manager' }))
          .status,
      ).toBe(201);
    });

    it('tells the recipient that there is feedback, and nothing else', async () => {
      const f = await gave(dan, gus, { kind: 'constructive', body: 'Secret criticism' });
      const notes = (await notesOf(gus)).filter((n) => n.type === 'feedback.received');
      expect(notes.find((n) => n.params.feedbackId === f.id)?.params).toEqual({ feedbackId: f.id });
      expect(JSON.stringify(notes)).not.toMatch(/Secret|criticism|constructive|dan/i);
      expect((await notesOf(dan)).filter((n) => n.params.feedbackId === f.id)).toEqual([]); // not told about their own doing
    });

    it('refuses feedback to yourself, to unknown, inactive and foreign people', async () => {
      const self = await give(dan, dan);
      expect([self.status, errorBody(self).details?.[0]?.code]).toEqual([400, 'self']);
      for (const to of [UNKNOWN, (await onboard(globex, 'outsider')).employeeId]) {
        const res = await give(dan, to);
        expect([res.status, errorBody(res).details?.[0]?.code], to).toEqual([
          400,
          'unknown_employee',
        ]);
      }
      const gone = await onboard(acme, 'gone');
      await hr.agent
        .post(`${api}/employees/${gone.employeeId}/deactivate`)
        .send({ terminationDate: today });
      const res = await give(dan, gone);
      expect(errorBody(res).details?.[0]?.code).toBe('unknown_employee');
    });

    it.each([
      ['no text', { body: '   ' }],
      ['a long text', { body: 'x'.repeat(2001) }],
      ['no recipient', { toEmployeeId: undefined }],
      ['a bad recipient', { toEmployeeId: 'nope' }],
      ['an unknown kind', { kind: 'rant' }],
      ['an unknown visibility', { visibility: 'public' }],
      ['an anonymous flag', { anonymous: true }],
      ['a sender', { fromEmployeeId: UNKNOWN }],
    ])('refuses %s', async (_label, body) => {
      const res = await dan.agent
        .post(`${api}/feedback`)
        .send({ toEmployeeId: eve.employeeId, kind: 'praise', body: 'ok', ...body });
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('accepts text of exactly the maximum length', async () => {
      expect((await give(dan, eve, { body: 'x'.repeat(2000) })).status).toBe(201);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('who reads what', () => {
    it('shows the recipient everything received and the giver everything given, newest first', async () => {
      const a = await gave(gus, ron, { body: 'First' });
      const b = await gave(eve, ron, { body: 'Second', visibility: 'recipient_and_manager' });
      expect((await listOf(ron)).items.map((f) => f.id).slice(0, 2)).toEqual([b.id, a.id]);
      expect(await ids(gus, { box: 'given' })).toContain(a.id);
      expect(await ids(gus, { box: 'given' })).not.toContain(b.id);
      expect(await ids(eve, { box: 'given' })).toContain(b.id);
      // received and given are separate boxes
      expect(await ids(gus)).not.toContain(a.id);
      expect(await ids(ron, { box: 'given' })).not.toContain(a.id);
    });

    it('keeps private feedback from the manager, HR and the administrator', async () => {
      const priv = await gave(dan, eve, { body: 'Private words' });
      const shared = await gave(dan, eve, {
        body: 'Shared words',
        visibility: 'recipient_and_manager',
      });
      expect(await ids(eve)).toEqual(expect.arrayContaining([priv.id, shared.id]));
      for (const who of [mia, hr]) {
        const seen = await ids(who, { employeeId: eve.employeeId });
        expect(seen, who.email).toContain(shared.id);
        expect(seen, who.email).not.toContain(priv.id);
        expect(JSON.stringify((await box(who, { employeeId: eve.employeeId })).body)).not.toContain(
          'Private words',
        );
      }
      for (const who of [admin, ron, gus, dan]) {
        const res = await box(who, { employeeId: eve.employeeId });
        expect([res.status, errorBody(res).code], who.email).toEqual([403, 'FORBIDDEN']);
      }
    });

    it('does not show a manager the feedback of people who do not report to them', async () => {
      const res = await box(mia, { employeeId: gus.employeeId });
      expect(res.status).toBe(403);
      expect((await box(mia, { employeeId: UNKNOWN })).status).toBe(403);
      // HR reads the shared items of anyone
      await gave(dan, gus, { visibility: 'recipient_and_manager', body: 'For the manager of gus' });
      expect((await listOf(hr, { employeeId: gus.employeeId })).total).toBeGreaterThan(0);
    });

    it('lets the administrator neither read received feedback nor see anything of other people', async () => {
      const adminOwn = await box(admin);
      expect(adminOwn.status).toBe(403); // no feedback.view_received for the administrator
      expect((await box(admin, { box: 'given' })).status).toBe(200);
    });

    it('pages the list and refuses unknown boxes', async () => {
      const fresh = await onboard(acme, 'pager');
      for (const n of [1, 2, 3]) await gave(dan, fresh, { body: `Note ${n}` });
      const page = await listOf(fresh, { pageSize: 2, page: 2 });
      expect([page.total, page.items.map((f) => f.body)]).toEqual([3, ['Note 1']]);
      for (const query of [{ box: 'all' }, { pageSize: 101 }, { page: 0 }, { employeeId: 'x' }]) {
        const res = await box(fresh, query);
        expect([res.status, errorBody(res).code], JSON.stringify(query)).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('taking feedback back', () => {
    it('lets the giver delete, once, and nobody else', async () => {
      const f = await gave(dan, eve);
      for (const who of [eve, mia, hr, admin, ron]) {
        const res = await del(who, f.id);
        expect([res.status, errorBody(res).code], who.email).toEqual([404, 'NOT_FOUND']);
      }
      expect((await del(dan, f.id)).status).toBe(204);
      expect((await del(dan, f.id)).status).toBe(404);
      expect(await ids(eve)).not.toContain(f.id);
      expect(await ids(dan, { box: 'given' })).not.toContain(f.id);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('reports and moderation', () => {
    it('lets only the recipient report an item, once', async () => {
      const f = await gave(dan, eve, { kind: 'constructive', body: 'Harsh words' });
      for (const who of [dan, mia, hr, admin, gus]) {
        expect((await report(who, f.id)).status, who.email).toBe(404);
      }
      const reported = feedbackItemSchema.parse((await report(eve, f.id)).body);
      expect(reported).toMatchObject({ report: 'open', canReport: false });
      const again = await report(eve, f.id);
      expect([again.status, errorBody(again).params?.field]).toEqual([409, 'report']);
      expect((await report(eve, UNKNOWN)).status).toBe(404);
      // reporting tells nobody
      expect((await notesOf(dan)).filter((n) => n.params.feedbackId === f.id)).toEqual([]);
    });

    it('shows reported items to moderators only, with the text', async () => {
      const f = await gave(dan, eve, { body: 'Reported text' });
      expect(await ids(hr, { box: 'reported' })).not.toContain(f.id); // not reported yet
      await report(eve, f.id);
      for (const who of [hr, admin]) {
        const list = await listOf(who, { box: 'reported' });
        const item = list.items.find((x) => x.id === f.id)!;
        expect(item, who.email).toMatchObject({
          body: 'Reported text',
          canKeep: true,
          canRemove: true,
          report: 'open',
        });
      }
      for (const who of [eve, dan, mia, ron, gus]) {
        const res = await box(who, { box: 'reported' });
        expect([res.status, errorBody(res).code], who.email).toEqual([403, 'FORBIDDEN']);
      }
    });

    it('lets a moderator keep a reported item, which then cannot be reported again', async () => {
      const f = await gave(dan, eve, { body: 'Keep me' });
      expect((await keep(hr, f.id)).status).toBe(404); // nothing to decide yet
      await report(eve, f.id);
      for (const who of [eve, dan, mia, ron]) {
        const res = await keep(who, f.id);
        expect([res.status, errorBody(res).code], who.email).toEqual([403, 'FORBIDDEN']);
      }
      const kept = feedbackItemSchema.parse((await keep(hr, f.id)).body);
      expect(kept).toMatchObject({ report: 'kept', canKeep: false, canReport: false });
      expect(await ids(hr, { box: 'reported' })).not.toContain(f.id);
      expect(await ids(eve)).toContain(f.id); // still there
      const again = await report(eve, f.id);
      expect([again.status, errorBody(again).params?.field]).toEqual([409, 'report']);
      expect((await keep(admin, f.id)).status).toBe(404); // already decided
    });

    it('lets a moderator remove a reported item, audited without the text', async () => {
      const f = await gave(dan, eve, { body: 'Remove this insult', kind: 'constructive' });
      expect((await del(hr, f.id)).status).toBe(404); // not reported: moderators cannot browse
      await report(eve, f.id);
      expect((await del(admin, f.id)).status).toBe(204);
      expect(await ids(eve)).not.toContain(f.id);
      expect(await ids(dan, { box: 'given' })).not.toContain(f.id);
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, entity: 'feedback' },
      });
      expect(entries.map((e) => e.action)).toContain('feedback.removed');
      expect(JSON.stringify(entries)).not.toMatch(/insult|Remove this/);
      expect(entries.find((e) => e.entityId === f.id)?.actorUserId).toBe(admin.id);
    });

    it('keeps a moderator out of decisions about their own feedback', async () => {
      const f = await gave(hr, eve, { body: 'From the moderator' });
      const g = await gave(dan, hr, { body: 'To the moderator' });
      await report(eve, f.id);
      await report(hr, g.id);
      // HR neither sees nor decides these two; the administrator does
      expect(await ids(hr, { box: 'reported' })).not.toEqual(expect.arrayContaining([f.id]));
      expect(await ids(hr, { box: 'reported' })).not.toEqual(expect.arrayContaining([g.id]));
      expect((await keep(hr, f.id)).status).toBe(404);
      expect((await keep(hr, g.id)).status).toBe(404);
      expect(await ids(admin, { box: 'reported' })).toEqual(expect.arrayContaining([f.id, g.id]));
      // the giver may still take their own back
      expect((await del(hr, f.id)).status).toBe(204);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('privacy', () => {
    it('exports what a person gave and received, by name', async () => {
      const person = await onboard(acme, 'exporter');
      await gave(person, eve, { body: 'I give this', kind: 'constructive' });
      await gave(eve, person, { body: 'I got this', visibility: 'recipient_and_manager' });
      const doc = personalDataExportSchema.parse(
        (await person.agent.get(`${api}/privacy/export`)).body,
      );
      expect(doc.feedback.given).toEqual([
        {
          to: 'eve Test',
          kind: 'constructive',
          visibility: 'recipient',
          body: 'I give this',
          createdAt: expect.any(String),
        },
      ]);
      expect(doc.feedback.received).toEqual([
        {
          from: 'eve Test',
          kind: 'praise',
          visibility: 'recipient_and_manager',
          body: 'I got this',
          createdAt: expect.any(String),
        },
      ]);
      const other = personalDataExportSchema.parse(
        (await gus.agent.get(`${api}/privacy/export`)).body,
      );
      expect(JSON.stringify(other.feedback)).not.toContain('I give this');
    });

    it('erases every item a former employee gave or received, and only those', async () => {
      const leaver = await onboard(acme, 'erasable');
      const out = await gave(leaver, eve, { body: 'Erase me, given' });
      const inn = await gave(dan, leaver, { body: 'Erase me, received' });
      const untouched = await gave(dan, eve, { body: 'Stays' });
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
      expect(await system.feedback.findMany({ where: { id: { in: [out.id, inn.id] } } })).toEqual(
        [],
      );
      expect(await system.feedback.findUnique({ where: { id: untouched.id } })).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('tenant isolation and database rules', () => {
    it('keeps another workspace away from feedback, in lists and in every write', async () => {
      const f = await gave(dan, eve, { body: 'Acme only' });
      await report(eve, f.id);
      const x = globex.admin;
      expect(await ids(x, { box: 'reported' })).not.toContain(f.id);
      expect(await ids(x, { box: 'given' })).toEqual([]);
      for (const res of [await del(x, f.id), await report(x, f.id), await keep(x, f.id)]) {
        expect([404, 403]).toContain(res.status);
      }
      const outsider = await onboard(globex, 'neighbour');
      for (const res of [await del(outsider, f.id), await report(outsider, f.id)]) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      expect(await system.feedback.findUnique({ where: { id: f.id } })).not.toBeNull();
    });

    it('enforces the rules in the database when the application is bypassed', async () => {
      const base = {
        tenantId: acme.tenantId,
        fromEmployeeId: dan.employeeId,
        toEmployeeId: eve.employeeId,
        kind: 'praise',
        body: 'Rules',
      };
      const refuse = (data: object) =>
        expect(system.feedback.create({ data: { ...base, ...data } as never })).rejects.toThrow();
      await refuse({ toEmployeeId: dan.employeeId }); // to oneself
      await refuse({ kind: 'rant' });
      await refuse({ visibility: 'public' });
      await refuse({ body: '' });
      await refuse({ body: 'x'.repeat(2001) });
      await refuse({ reportedAt: new Date(), keptAt: new Date() }); // open and closed at once
      await refuse({ fromEmployeeId: UNKNOWN });
      const ok = await system.feedback.create({ data: { ...base, reportedAt: new Date() } });
      await expect(
        system.feedback.update({ where: { id: ok.id }, data: { keptAt: new Date() } }),
      ).rejects.toThrow();
      expect(
        (
          await system.feedback.update({
            where: { id: ok.id },
            data: { reportedAt: null, keptAt: new Date() },
          })
        ).keptAt,
      ).not.toBeNull();
    });
  });
});
