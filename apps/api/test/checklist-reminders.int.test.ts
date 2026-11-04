import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  checklistDetailSchema,
  checklistTemplateSchema,
  employeeSchema,
  todayIn,
  zonedToUtc,
  type ChecklistDetail,
  type TemplateRequest,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { RemindersService } from '../src/modules/notifications/delivery/reminders.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const ZONE = 'Europe/Sofia';
const api = '/api/v1';

describe.skipIf(!urls)('checklist step reminders (real database)', () => {
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
  let dan: Person;
  let eve: Person;
  let gus: Person;
  let nobodyId: string; // an employee without an account
  const today = todayIn(ZONE);
  /** Noon of a workspace day, as the sweep's "now". */
  const noon = (date: string) => zonedToUtc(date, '12:00', ZONE)!;
  const reminders = () => app.get(RemindersService);

  async function onboard(ws: Workspace, name: string): Promise<Person> {
    const email = `${name}@${ws === acme ? 'acme' : 'globex'}.eu`;
    const res = await ws.admin.agent
      .post(`${api}/employees`)
      .send({ firstName: name, lastName: 'Test', employmentType: 'full_time', email });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const who = await accept(email);
    return { ...who, employeeId: employeeSchema.parse(res.body).id };
  }

  /** A non-default template with one step per entry, all done by the person the checklist is about. */
  async function startWith(
    ws: Workspace,
    employeeId: string,
    steps: { title: string; offsetDays: number; responsible?: 'employee' | 'hr' }[],
    anchorDate = today,
  ): Promise<ChecklistDetail> {
    const body: TemplateRequest = {
      name: `Template ${Math.random().toString(36).slice(2, 8)}`,
      kind: 'onboarding',
      isDefault: false,
      items: steps.map((s) => ({
        title: s.title,
        description: null,
        responsible: s.responsible ?? 'employee',
        offsetDays: s.offsetDays,
      })),
    };
    const made = await ws.admin.agent.post(`${api}/checklist-templates`).send(body);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const templateId = checklistTemplateSchema.parse(made.body).id;
    const res = await ws.admin.agent
      .post(`${api}/checklists`)
      .send({ employeeId, templateId, anchorDate });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return checklistDetailSchema.parse(res.body);
  }

  const itemId = (c: ChecklistDetail, title: string) => c.items.find((i) => i.title === title)!.id;
  const dueEvents = (tenantId: string, checklistId?: string) =>
    system.outboxEvent.findMany({
      where: {
        tenantId,
        type: 'checklist.due',
        ...(checklistId ? { params: { path: ['checklistId'], equals: checklistId } } : {}),
      },
    });
  const remindedAt = async (id: string) =>
    (await system.checklistItem.findUniqueOrThrow({ where: { id } })).remindedAt;

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    for (const ws of [acme, globex]) {
      await system.tenant.update({ where: { id: ws.tenantId }, data: { defaultTimezone: ZONE } });
    }
    dan = await onboard(acme, 'dan');
    eve = await onboard(acme, 'eve');
    gus = await onboard(globex, 'gus');
    const nobody = await acme.admin.agent
      .post(`${api}/employees`)
      .send({ firstName: 'No', lastName: 'Account', employmentType: 'full_time' });
    expect(nobody.status).toBe(201);
    nobodyId = employeeSchema.parse(nobody.body).id;
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  it('reminds the assignee once for a step due today and once for one due tomorrow', async () => {
    const c = await startWith(acme, dan.employeeId, [
      { title: 'Today', offsetDays: 0 },
      { title: 'Tomorrow', offsetDays: 1 },
      { title: 'Later', offsetDays: 2 },
      { title: 'Overdue', offsetDays: -1 },
    ]);
    const first = await reminders().run(noon(today));
    expect(first.checklists).toBeGreaterThanOrEqual(2);
    const events = await dueEvents(acme.tenantId, c.id);
    expect(
      events.map((e) => e.params).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
    ).toEqual(
      [
        { recipientUserId: dan.id, checklistId: c.id, date: today },
        { recipientUserId: dan.id, checklistId: c.id, date: addDays(today, 1) },
      ].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
    );
    // never the title, a name or the kind
    expect(JSON.stringify(events.map((e) => e.params))).not.toMatch(
      /Today|Tomorrow|dan|onboarding/,
    );
    expect(await remindedAt(itemId(c, 'Overdue'))).toBeNull();
    expect(await remindedAt(itemId(c, 'Later'))).toBeNull();

    // a second run (or a second server) sends nothing again
    await reminders().run(noon(today));
    expect(await dueEvents(acme.tenantId, c.id)).toHaveLength(2);

    // the next day the step that was two days away is due tomorrow
    await reminders().run(noon(addDays(today, 1)));
    const later = await dueEvents(acme.tenantId, c.id);
    expect(later).toHaveLength(3);
    expect(later.map((e) => (e.params as { date: string }).date)).toContain(addDays(today, 2));
  });

  it('does not remind a step that is done, nor steps of a cancelled checklist', async () => {
    const done = await startWith(acme, eve.employeeId, [{ title: 'Done already', offsetDays: 0 }]);
    const ticked = await eve.agent
      .put(`${api}/checklists/${done.id}/items/${itemId(done, 'Done already')}/done`)
      .send({ done: true });
    expect(ticked.status, JSON.stringify(ticked.body)).toBe(200);

    const offboarding = await acme.admin.agent.post(`${api}/checklist-templates`).send({
      name: 'Leaving',
      kind: 'offboarding',
      isDefault: false,
      items: [
        { title: 'Return laptop', description: null, responsible: 'employee', offsetDays: 0 },
      ],
    } satisfies TemplateRequest);
    expect(offboarding.status).toBe(201);
    const leaving = await acme.admin.agent.post(`${api}/checklists`).send({
      employeeId: eve.employeeId,
      templateId: checklistTemplateSchema.parse(offboarding.body).id,
      anchorDate: today,
    });
    expect(leaving.status).toBe(201);
    const leavingId = checklistDetailSchema.parse(leaving.body).id;
    expect((await acme.admin.agent.post(`${api}/checklists/${leavingId}/cancel`)).status).toBe(200);

    await reminders().run(noon(today));
    expect(await dueEvents(acme.tenantId, done.id)).toHaveLength(0);
    expect(await dueEvents(acme.tenantId, leavingId)).toHaveLength(0);
  });

  it('reminds nobody for HR-group steps and nobody without an account', async () => {
    const c = await startWith(acme, nobodyId, [
      { title: 'For HR', offsetDays: 0, responsible: 'hr' },
      { title: 'For the person', offsetDays: 0 },
    ]);
    await reminders().run(noon(today));
    expect(await dueEvents(acme.tenantId, c.id)).toHaveLength(0);
    // the HR-group step is not even claimed; the step without an account is claimed so it is not looked at again
    expect(await remindedAt(itemId(c, 'For HR'))).toBeNull();
    expect(await remindedAt(itemId(c, 'For the person'))).not.toBeNull();
  });

  it('reminds again after the due date or the assignee changes', async () => {
    const [c] = (
      await system.checklist.findMany({
        where: { tenantId: acme.tenantId, employeeId: dan.employeeId, status: 'open' },
        include: { items: true },
      })
    ).map((row) => row);
    const today0 = c!.items.find((i) => i.title === 'Today')!;
    expect(today0.remindedAt).not.toBeNull();

    // moved to tomorrow: reminded again for the new date
    const moved = await acme.admin.agent
      .patch(`${api}/checklists/${c!.id}/items/${today0.id}`)
      .send({ dueDate: addDays(today, 1) });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(await remindedAt(today0.id)).toBeNull();
    // handed to eve: reminded again for the new person
    const tomorrow = c!.items.find((i) => i.title === 'Tomorrow')!;
    const handed = await acme.admin.agent
      .patch(`${api}/checklists/${c!.id}/items/${tomorrow.id}`)
      .send({ assigneeEmployeeId: eve.employeeId });
    expect(handed.status, JSON.stringify(handed.body)).toBe(200);
    expect(await remindedAt(tomorrow.id)).toBeNull();
    // a change of the title alone keeps the claim
    const later = c!.items.find((i) => i.title === 'Later')!;
    const before = await remindedAt(later.id);
    const renamed = await acme.admin.agent
      .patch(`${api}/checklists/${c!.id}/items/${later.id}`)
      .send({ title: 'Later still' });
    expect(renamed.status).toBe(200);
    expect(await remindedAt(later.id)).toEqual(before);

    await reminders().run(noon(today));
    const events = (await dueEvents(acme.tenantId, c!.id)).map((e) => e.params);
    expect(events).toContainEqual({
      recipientUserId: dan.id,
      checklistId: c!.id,
      date: addDays(today, 1),
    });
    expect(events).toContainEqual({
      recipientUserId: eve.id,
      checklistId: c!.id,
      date: addDays(today, 1),
    });
  });

  it('does not remind a deactivated assignee', async () => {
    const c = await startWith(globex, gus.employeeId, [{ title: 'Soon', offsetDays: 1 }]);
    await system.employee.update({ where: { id: gus.employeeId }, data: { status: 'inactive' } });
    await reminders().run(noon(today));
    expect(await dueEvents(globex.tenantId, c.id)).toHaveLength(0);
  });

  it('keeps every workspace to its own steps', async () => {
    const all = await system.outboxEvent.findMany({ where: { type: 'checklist.due' } });
    const acmeChecklists = new Set(
      (await system.checklist.findMany({ where: { tenantId: acme.tenantId } })).map((c) => c.id),
    );
    for (const event of all) {
      const id = (event.params as { checklistId: string }).checklistId;
      expect(acmeChecklists.has(id)).toBe(event.tenantId === acme.tenantId);
    }
    expect(all.some((e) => e.tenantId === globex.tenantId)).toBe(false);
  });
});
