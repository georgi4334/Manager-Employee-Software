import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  checklistDetailSchema,
  checklistListSchema,
  checklistTemplateListSchema,
  checklistTemplateSchema,
  employeeSchema,
  myChecklistItemListSchema,
  personalDataExportSchema,
  todayIn,
  type ChecklistDetail,
  type SystemRole,
  type TemplateRequest,
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

describe.skipIf(!urls)('onboarding and offboarding checklists over HTTP (real database)', () => {
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
  let mia: Person; // manager of dan and eve
  let ron: Person; // manager without reports
  let dan: Person;
  let eve: Person;
  let gus: Person;
  const today = todayIn(ZONE);

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
  const assign = async (who: Person, managerId: string | null) => {
    const res = await acme.admin.agent
      .put(`${api}/org/employees/${who.employeeId}/assignment`)
      .send({ managerId, departmentId: null });
    expect(res.status).toBe(204);
  };

  const template = (body: Partial<TemplateRequest> = {}): TemplateRequest => ({
    name: 'Standard onboarding',
    kind: 'onboarding',
    isDefault: false,
    items: [
      { title: 'Sign the contract', description: null, responsible: 'hr', offsetDays: -7 },
      {
        title: 'Welcome lunch',
        description: 'Pick a place',
        responsible: 'manager',
        offsetDays: 0,
      },
      { title: 'Read the handbook', description: null, responsible: 'employee', offsetDays: 3 },
    ],
    ...body,
  });
  const createTemplate = async (body: Partial<TemplateRequest> = {}, who: Member = hr) => {
    const res = await who.agent.post(`${api}/checklist-templates`).send(template(body));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return checklistTemplateSchema.parse(res.body);
  };
  const start = (who: Member, employeeId: string, templateId: string, anchorDate?: string) =>
    who.agent.post(`${api}/checklists`).send({ employeeId, templateId, anchorDate });
  const started = async (
    who: Member,
    employeeId: string,
    templateId: string,
    anchorDate?: string,
  ) => {
    const res = await start(who, employeeId, templateId, anchorDate);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return checklistDetailSchema.parse(res.body);
  };
  const tick = (who: Member, checklist: ChecklistDetail, title: string, done = true) =>
    who.agent
      .put(
        `${api}/checklists/${checklist.id}/items/${checklist.items.find((i) => i.title === title)!.id}/done`,
      )
      .send({ done });
  const cancel = (who: Member, id: string) => who.agent.post(`${api}/checklists/${id}/cancel`);
  const view = (who: Member, id: string) => who.agent.get(`${api}/checklists/${id}`);
  const outbox = (checklistId: string) =>
    system.outboxEvent.findMany({
      where: {
        tenantId: acme.tenantId,
        type: 'checklist.assigned',
        params: { path: ['checklistId'], equals: checklistId },
      },
    });

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
    await assign(dan, mia.employeeId);
    await assign(eve, mia.employeeId);
  });

  afterAll(async () => {
    // The database is shared by all test files: the next one creates "acme" and "globex" again.
    await system?.tenant.deleteMany();
    await app?.close();
  });

  describe('templates', () => {
    it('HR creates, changes and deletes a template; the audit has no names', async () => {
      const made = await createTemplate();
      expect(made.items.map((i) => [i.title, i.responsible, i.offsetDays])).toEqual([
        ['Sign the contract', 'hr', -7],
        ['Welcome lunch', 'manager', 0],
        ['Read the handbook', 'employee', 3],
      ]);
      expect(made.canEdit).toBe(true);
      const changed = await hr.agent
        .put(`${api}/checklist-templates/${made.id}`)
        .send(template({ name: 'Renamed', items: [template().items[2]!] }));
      expect(changed.status).toBe(200);
      expect(checklistTemplateSchema.parse(changed.body).items).toHaveLength(1);
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, entityId: made.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(entries.map((e) => e.action)).toEqual([
        'checklist_template.created',
        'checklist_template.updated',
      ]);
      expect(JSON.stringify(entries)).not.toMatch(/Renamed|Standard|handbook/);
      expect((await hr.agent.delete(`${api}/checklist-templates/${made.id}`)).status).toBe(204);
      expect((await hr.agent.get(`${api}/checklist-templates/${made.id}`)).status).toBe(404);
    });

    it('keeps one default per kind', async () => {
      const first = await createTemplate({ name: 'First', isDefault: true });
      const second = await createTemplate({ name: 'Second', isDefault: true });
      const off = await createTemplate({ name: 'Leaving', kind: 'offboarding', isDefault: true });
      const list = checklistTemplateListSchema.parse(
        (await hr.agent.get(`${api}/checklist-templates`)).body,
      ).items;
      const byId = new Map(list.map((t) => [t.id, t]));
      expect(byId.get(first.id)?.isDefault).toBe(false);
      expect(byId.get(second.id)?.isDefault).toBe(true);
      expect(byId.get(off.id)?.isDefault).toBe(true);
      // clean up for the automatic starts below
      for (const t of [first, second, off])
        await hr.agent.delete(`${api}/checklist-templates/${t.id}`);
    });

    it('refuses invalid templates and people without the permission', async () => {
      const bad = await hr.agent.post(`${api}/checklist-templates`).send(
        template({
          items: [{ title: 'x', description: null, responsible: 'hr', offsetDays: 999 }],
        }),
      );
      expect([bad.status, errorBody(bad).code]).toEqual([400, 'VALIDATION_FAILED']);
      for (const who of [mia, dan]) {
        const res = await who.agent.post(`${api}/checklist-templates`).send(template());
        expect(res.status).toBe(403);
      }
      // managers read templates to start a checklist; employees do not
      expect((await mia.agent.get(`${api}/checklist-templates`)).status).toBe(200);
      expect((await dan.agent.get(`${api}/checklist-templates`)).status).toBe(403);
      expect((await hr.agent.get(`${api}/checklist-templates/${UNKNOWN}`)).status).toBe(404);
    });
  });

  describe('running a checklist', () => {
    let tpl: string;
    let run: ChecklistDetail;

    beforeAll(async () => {
      tpl = (await createTemplate({ name: 'Manual' })).id;
    });

    it('a manager starts one for a report: due dates and assignees are resolved', async () => {
      const anchor = addDays(today, 10);
      run = await started(mia, dan.employeeId, tpl, anchor);
      expect(run.status).toBe('open');
      expect(run.anchorDate).toBe(anchor);
      expect(run.items.map((i) => [i.title, i.assignee?.id ?? null, i.dueDate])).toEqual([
        ['Sign the contract', null, addDays(anchor, -7)],
        ['Welcome lunch', mia.employeeId, anchor],
        ['Read the handbook', dan.employeeId, addDays(anchor, 3)],
      ]);
      expect(run.canManage).toBe(true);
      // dan is told about his item; mia started it herself and is not
      const events = await outbox(run.id);
      expect(events.map((e) => e.params)).toEqual([
        { recipientUserId: dan.id, checklistId: run.id, count: 1 },
      ]);
    });

    it('refuses a second open checklist of the same kind, outsiders and unknown people', async () => {
      const again = await start(hr, dan.employeeId, tpl);
      expect([again.status, errorBody(again).params?.field]).toEqual([409, 'open']);
      expect((await start(ron, dan.employeeId, tpl)).status).toBe(403);
      expect((await start(dan, eve.employeeId, tpl)).status).toBe(403);
      expect((await start(hr, UNKNOWN, tpl)).status).toBe(404);
      expect((await start(hr, eve.employeeId, UNKNOWN)).status).toBe(404);
    });

    it('is seen by the person, their manager, HR and assignees only', async () => {
      for (const who of [dan, mia, hr]) expect((await view(who, run.id)).status).toBe(200);
      for (const who of [eve, gus, ron]) expect((await view(who, run.id)).status).toBe(404);
      const list = checklistListSchema.parse((await eve.agent.get(`${api}/checklists`)).body);
      expect(list.items.map((c) => c.id)).not.toContain(run.id);
      const own = checklistListSchema.parse((await dan.agent.get(`${api}/checklists`)).body);
      expect(own.items.map((c) => c.id)).toContain(run.id);
      // an assignee without any view grant still sees the checklist of their item
      const lunch = run.items.find((i) => i.title === 'Welcome lunch')!;
      const moved = await mia.agent
        .patch(`${api}/checklists/${run.id}/items/${lunch.id}`)
        .send({ assigneeEmployeeId: gus.employeeId });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect((await view(gus, run.id)).status).toBe(200);
      expect(
        (await outbox(run.id)).some(
          (e) => (e.params as { recipientUserId: string }).recipientUserId === gus.id,
        ),
      ).toBe(true);
      await mia.agent
        .patch(`${api}/checklists/${run.id}/items/${lunch.id}`)
        .send({ assigneeEmployeeId: mia.employeeId });
    });

    it('lets assignees, the HR group and the manager tick; nobody else', async () => {
      const handbook = await tick(dan, run, 'Read the handbook');
      expect(handbook.status, JSON.stringify(handbook.body)).toBe(200);
      const after = checklistDetailSchema.parse(handbook.body);
      const done = after.items.find((i) => i.title === 'Read the handbook')!;
      expect([done.done, done.doneBy?.id]).toEqual([true, dan.employeeId]);
      // dan may not tick the HR item or the manager's
      expect((await tick(dan, run, 'Sign the contract')).status).toBe(403);
      expect((await tick(dan, run, 'Welcome lunch')).status).toBe(403);
      expect((await tick(hr, run, 'Sign the contract')).status).toBe(200);
      const last = checklistDetailSchema.parse((await tick(mia, run, 'Welcome lunch')).body);
      expect(last.status).toBe('done');
      expect(last.completedAt).not.toBeNull();
      const reopened = checklistDetailSchema.parse(
        (await tick(mia, run, 'Welcome lunch', false)).body,
      );
      expect(reopened.status).toBe('open');
      run = reopened;
    });

    it('managers add, change and remove items; an unknown assignee is refused', async () => {
      const add = await mia.agent
        .post(`${api}/checklists/${run.id}/items`)
        .send({ title: 'Team intro', responsible: 'manager', dueDate: today });
      expect(add.status, JSON.stringify(add.body)).toBe(201);
      const added = checklistDetailSchema
        .parse(add.body)
        .items.find((i) => i.title === 'Team intro')!;
      expect(added.assignee?.id).toBe(mia.employeeId);
      const bad = await mia.agent
        .patch(`${api}/checklists/${run.id}/items/${added.id}`)
        .send({ assigneeEmployeeId: UNKNOWN });
      expect(errorBody(bad).details?.[0]?.code).toBe('unknown_employee');
      expect(
        (
          await dan.agent
            .post(`${api}/checklists/${run.id}/items`)
            .send({ title: 'x', responsible: 'hr', dueDate: today })
        ).status,
      ).toBe(403);
      const removed = await mia.agent.delete(`${api}/checklists/${run.id}/items/${added.id}`);
      expect(removed.status).toBe(200);
      expect((await mia.agent.delete(`${api}/checklists/${run.id}/items/${UNKNOWN}`)).status).toBe(
        404,
      );
    });

    it('lists my open items, and HR-group items for HR', async () => {
      const mine = myChecklistItemListSchema.parse(
        (await mia.agent.get(`${api}/checklists/my-items`)).body,
      );
      expect(mine.items.map((i) => i.title)).toContain('Welcome lunch');
      expect(mine.items.every((i) => i.mine)).toBe(true);
      await tick(hr, run, 'Sign the contract', false);
      const forHr = myChecklistItemListSchema.parse(
        (await hr.agent.get(`${api}/checklists/my-items`)).body,
      );
      expect(forHr.items.find((i) => i.title === 'Sign the contract')?.mine).toBe(false);
      const forDan = myChecklistItemListSchema.parse(
        (await dan.agent.get(`${api}/checklists/my-items`)).body,
      );
      expect(forDan.items.map((i) => i.title)).not.toContain('Sign the contract');
    });

    it('a cancelled checklist is locked', async () => {
      expect((await cancel(dan, run.id)).status).toBe(403);
      const res = await cancel(mia, run.id);
      expect(res.status).toBe(200);
      expect(checklistDetailSchema.parse(res.body).status).toBe('cancelled');
      expect(errorBody(await tick(dan, run, 'Read the handbook', false)).params?.field).toBe(
        'status',
      );
      expect(errorBody(await cancel(mia, run.id)).params?.field).toBe('status');
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, entityId: run.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(entries.map((e) => e.action)).toEqual(['checklist.started', 'checklist.cancelled']);
    });
  });

  describe('the employee lifecycle', () => {
    it('starts the default onboarding for a new person and offboarding when they leave', async () => {
      const on = await createTemplate({ name: 'Default on', isDefault: true });
      const off = await createTemplate({
        name: 'Default off',
        kind: 'offboarding',
        isDefault: true,
        items: [
          { title: 'Return the laptop', description: null, responsible: 'manager', offsetDays: 0 },
        ],
      });
      const res = await acme.admin.agent
        .post(`${api}/employees`)
        .send({ firstName: 'Leo', lastName: 'Test', employmentType: 'full_time', hireDate: today });
      const leo = employeeSchema.parse(res.body).id;
      await assign({ employeeId: leo } as Person, mia.employeeId);
      const onboarding = checklistListSchema.parse(
        (await hr.agent.get(`${api}/checklists`).query({ employeeId: leo })).body,
      ).items;
      expect(onboarding.map((c) => [c.kind, c.anchorDate, c.total])).toEqual([
        ['onboarding', today, 3],
      ]);

      // leo is also somebody else's assignee
      const other = await started(hr, eve.employeeId, (await createTemplate({ name: 'Eve' })).id);
      const item = other.items[0]!;
      await hr.agent
        .patch(`${api}/checklists/${other.id}/items/${item.id}`)
        .send({ assigneeEmployeeId: leo });

      const leaving = addDays(today, 14);
      const gone = await hr.agent
        .post(`${api}/employees/${leo}/deactivate`)
        .send({ terminationDate: leaving });
      expect(gone.status, JSON.stringify(gone.body)).toBe(200);
      const all = checklistListSchema.parse(
        (await hr.agent.get(`${api}/checklists`).query({ employeeId: leo, status: 'all' })).body,
      ).items;
      expect(all.map((c) => [c.kind, c.status, c.anchorDate]).sort()).toEqual([
        ['offboarding', 'open', leaving],
        ['onboarding', 'cancelled', today],
      ]);
      const offRun = checklistDetailSchema.parse(
        (await view(hr, all.find((c) => c.kind === 'offboarding')!.id)).body,
      );
      expect(offRun.items.map((i) => [i.title, i.assignee?.id])).toEqual([
        ['Return the laptop', mia.employeeId],
      ]);
      const eveRun = checklistDetailSchema.parse((await view(hr, other.id)).body);
      expect(eveRun.items.find((i) => i.id === item.id)?.assignee).toBeNull();
      for (const t of [on, off]) await hr.agent.delete(`${api}/checklist-templates/${t.id}`);
    });

    it('starts nothing without a default template', async () => {
      const res = await acme.admin.agent
        .post(`${api}/employees`)
        .send({ firstName: 'Ned', lastName: 'Test', employmentType: 'full_time' });
      const ned = employeeSchema.parse(res.body).id;
      expect(
        await system.checklist.count({ where: { tenantId: acme.tenantId, employeeId: ned } }),
      ).toBe(0);
    });
  });

  describe('privacy and isolation', () => {
    it('another workspace sees, ticks and starts nothing of ours', async () => {
      const tpl = await createTemplate({ name: 'Isolation' });
      const run = await started(hr, gus.employeeId, tpl.id);
      expect((await view(globex.admin, run.id)).status).toBe(404);
      expect((await tick(globex.admin, run, 'Sign the contract')).status).toBe(404);
      expect((await cancel(globex.admin, run.id)).status).toBe(404);
      expect((await globex.admin.agent.get(`${api}/checklist-templates/${tpl.id}`)).status).toBe(
        404,
      );
      expect((await start(globex.admin, gus.employeeId, tpl.id)).status).toBe(404);
      const theirs = checklistListSchema.parse(
        (await globex.admin.agent.get(`${api}/checklists`).query({ status: 'all' })).body,
      );
      expect(theirs.items).toEqual([]);
      expect(
        checklistTemplateListSchema.parse(
          (await globex.admin.agent.get(`${api}/checklist-templates`)).body,
        ).items,
      ).toEqual([]);
    });

    it('exports the checklists about a person and their items elsewhere, and erasure removes them', async () => {
      const tpl = await createTemplate({ name: 'Export' });
      const ida = await onboard(acme, 'ida');
      const about = await started(hr, ida.employeeId, tpl.id);
      const elsewhere = await started(hr, ron.employeeId, tpl.id);
      await hr.agent
        .patch(`${api}/checklists/${elsewhere.id}/items/${elsewhere.items[0]!.id}`)
        .send({ assigneeEmployeeId: ida.employeeId });
      await tick(
        ida,
        checklistDetailSchema.parse((await view(ida, elsewhere.id)).body),
        'Sign the contract',
      );

      const exported = personalDataExportSchema.parse(
        (await ida.agent.get(`${api}/privacy/export`)).body,
      );
      expect(exported.checklists.about.map((c) => [c.kind, c.items.length])).toEqual([
        ['onboarding', 3],
      ]);
      expect(exported.checklists.assigned).toEqual([
        { title: 'Sign the contract', dueDate: elsewhere.items[0]!.dueDate, done: true },
      ]);

      await hr.agent
        .post(`${api}/employees/${ida.employeeId}/deactivate`)
        .send({ terminationDate: today });
      const erased = await hr.agent
        .post(`${api}/privacy/erase/${ida.employeeId}`)
        .send({ confirm: true });
      expect(erased.status, JSON.stringify(erased.body)).toBe(204);
      expect(await system.checklist.count({ where: { id: about.id } })).toBe(0);
      const kept = await system.checklistItem.findUniqueOrThrow({
        where: { id: elsewhere.items[0]!.id },
      });
      expect([kept.assigneeEmployeeId, kept.doneByEmployeeId, kept.doneAt !== null]).toEqual([
        null,
        null,
        true,
      ]);
    });
  });
});
