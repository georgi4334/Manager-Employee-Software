import { Injectable } from '@nestjs/common';
import {
  CHECKLIST_LIMITS,
  checklistDueDate,
  checklistItemState,
  checklistStatusFor,
  type ChecklistDetail,
  type ChecklistItem,
  type ChecklistKind,
  type ChecklistList,
  type ChecklistQuery,
  type ChecklistResponsible,
  type ChecklistStatus,
  type ChecklistSummary,
  type ChecklistTemplate,
  type ChecklistTemplateList,
  type CreateChecklistItemRequest,
  type MyChecklistItemList,
  type StartChecklistRequest,
  type TemplateRequest,
  type UpdateChecklistItemRequest,
} from '@intime/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import {
  conflict,
  dateIn,
  dateOut,
  forbidden,
  guardUnique,
  invalid,
  notFound,
} from '../projects/projects.shared.js';
import { workspaceToday } from '../projects/projects.present.js';

const PERSON = { id: true, firstName: true, lastName: true } as const;

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  kind: true,
  isDefault: true,
  items: {
    select: { id: true, title: true, description: true, responsible: true, offsetDays: true },
    orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.ChecklistTemplateSelect;
type TemplateRow = Prisma.ChecklistTemplateGetPayload<{ select: typeof TEMPLATE_SELECT }>;

const ITEM_SELECT = {
  id: true,
  title: true,
  description: true,
  responsible: true,
  assigneeEmployeeId: true,
  dueDate: true,
  doneAt: true,
  assignee: { select: PERSON },
  doneBy: { select: PERSON },
} satisfies Prisma.ChecklistItemSelect;
type ItemRow = Prisma.ChecklistItemGetPayload<{ select: typeof ITEM_SELECT }>;

const CHECKLIST_SELECT = {
  id: true,
  employeeId: true,
  kind: true,
  name: true,
  anchorDate: true,
  status: true,
  completedAt: true,
  cancelledAt: true,
  createdAt: true,
  employee: { select: PERSON },
  items: { select: ITEM_SELECT, orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.ChecklistSelect;
type ChecklistRow = Prisma.ChecklistGetPayload<{ select: typeof CHECKLIST_SELECT }>;

const NONE = '00000000-0000-0000-0000-000000000000';

const person = (p: { id: string; firstName: string; lastName: string }) => ({
  id: p.id,
  firstName: p.firstName,
  lastName: p.lastName,
});

/** Onboarding and offboarding checklists (docs/adr/0040-onboarding-checklists.md). */
@Injectable()
export class ChecklistsService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  // ----- templates -----------------------------------------------------------------------------

  listTemplates(actor: RequestAuth): Promise<ChecklistTemplateList> {
    this.assertReadsTemplates(actor);
    return this.db.tx(async (tx) => {
      const rows = await tx.checklistTemplate.findMany({
        select: TEMPLATE_SELECT,
        orderBy: [{ kind: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      });
      return { items: rows.map((row) => this.presentTemplate(actor, row)) };
    });
  }

  getTemplate(actor: RequestAuth, id: string): Promise<ChecklistTemplate> {
    this.assertReadsTemplates(actor);
    return this.db.tx(async (tx) => this.presentTemplate(actor, await this.findTemplate(tx, id)));
  }

  createTemplate(actor: RequestAuth, body: TemplateRequest): Promise<ChecklistTemplate> {
    return this.db.tx(async (tx) => {
      await this.lockTemplates(tx);
      if ((await tx.checklistTemplate.count()) >= CHECKLIST_LIMITS.templates) {
        throw conflict('limit', 'Too many templates');
      }
      if (body.isDefault) await this.clearDefault(tx, body.kind);
      const created = await tx.checklistTemplate.create({
        data: { name: body.name, kind: body.kind, isDefault: body.isDefault },
        select: { id: true },
      });
      await this.writeTemplateItems(tx, created.id, body.items);
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'checklist_template.created',
        entity: 'checklist_template',
        entityId: created.id,
        after: { kind: body.kind, isDefault: body.isDefault, items: body.items.length },
      });
      return this.presentTemplate(actor, await this.findTemplate(tx, created.id));
    });
  }

  updateTemplate(
    actor: RequestAuth,
    id: string,
    body: TemplateRequest,
  ): Promise<ChecklistTemplate> {
    return this.db.tx(async (tx) => {
      await this.lockTemplates(tx);
      const before = await this.findTemplate(tx, id);
      if (body.isDefault && !(before.isDefault && before.kind === body.kind)) {
        await this.clearDefault(tx, body.kind);
      }
      await tx.checklistTemplate.update({
        where: { id },
        data: { name: body.name, kind: body.kind, isDefault: body.isDefault },
      });
      await tx.checklistTemplateItem.deleteMany({ where: { templateId: id } });
      await this.writeTemplateItems(tx, id, body.items);
      const changed = [
        ...(before.name !== body.name ? ['name'] : []),
        ...(before.kind !== body.kind ? ['kind'] : []),
        ...(before.isDefault !== body.isDefault ? ['isDefault'] : []),
        'items',
      ];
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'checklist_template.updated',
        entity: 'checklist_template',
        entityId: id,
        after: { fields: changed },
      });
      return this.presentTemplate(actor, await this.findTemplate(tx, id));
    });
  }

  deleteTemplate(actor: RequestAuth, id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      await this.findTemplate(tx, id);
      // Running checklists keep their own copies of the items.
      await tx.checklistTemplate.delete({ where: { id } });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'checklist_template.deleted',
        entity: 'checklist_template',
        entityId: id,
      });
    });
  }

  // ----- checklists ----------------------------------------------------------------------------

  list(actor: RequestAuth, query: ChecklistQuery): Promise<ChecklistList> {
    return this.db.tx(async (tx) => {
      const where: Prisma.ChecklistWhereInput = {
        AND: [
          await this.visibleWhere(tx, actor),
          query.employeeId ? { employeeId: query.employeeId } : {},
          query.kind === 'all' ? {} : { kind: query.kind },
          query.status === 'all' ? {} : { status: query.status },
        ],
      };
      const [rows, total, today] = await Promise.all([
        tx.checklist.findMany({
          where,
          select: CHECKLIST_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.checklist.count({ where }),
        workspaceToday(tx, this.context),
      ]);
      return {
        items: rows.map((row) => this.summary(row, today)),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  get(actor: RequestAuth, id: string): Promise<ChecklistDetail> {
    return this.db.tx(async (tx) => this.detail(tx, actor, await this.findVisible(tx, actor, id)));
  }

  start(actor: RequestAuth, body: StartChecklistRequest): Promise<ChecklistDetail> {
    return this.db.tx(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { id: body.employeeId, erasedAt: null },
        select: { id: true },
      });
      if (!employee) throw notFound('Employee');
      await this.assertManages(actor, employee.id);
      const template = await this.findTemplate(tx, body.templateId);
      const id = await this.startFrom(tx, actor.userId, employee.id, template, body.anchorDate);
      return this.detail(tx, actor, await this.load(tx, id));
    });
  }

  cancel(actor: RequestAuth, id: string): Promise<ChecklistDetail> {
    return this.db.tx(async (tx) => {
      // The same lock as ticking: a last tick and a cancel must not cross (status vs completed_at).
      await this.lockChecklist(tx, id);
      const row = await this.findVisible(tx, actor, id);
      await this.assertManages(actor, row.employeeId);
      if (row.status !== 'open')
        throw conflict('status', 'Only an open checklist can be cancelled');
      await tx.checklist.update({
        where: { id },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'checklist.cancelled',
        entity: 'checklist',
        entityId: id,
        after: { employeeId: row.employeeId, kind: row.kind },
      });
      return this.detail(tx, actor, await this.load(tx, id));
    });
  }

  addItem(
    actor: RequestAuth,
    id: string,
    body: CreateChecklistItemRequest,
  ): Promise<ChecklistDetail> {
    return this.db.tx(async (tx) => {
      const row = await this.editable(tx, actor, id);
      if (row.items.length >= CHECKLIST_LIMITS.items) throw conflict('limit', 'Too many items');
      const assignee =
        body.assigneeEmployeeId === undefined
          ? await this.resolve(tx, row.employeeId, body.responsible)
          : await this.assignable(tx, body.assigneeEmployeeId);
      await tx.checklistItem.create({
        data: {
          checklistId: id,
          title: body.title,
          description: body.description,
          responsible: body.responsible,
          assigneeEmployeeId: assignee,
          dueDate: dateIn(body.dueDate),
          position: row.items.length,
        },
      });
      await this.syncStatus(tx, id);
      if (assignee) await this.notify(tx, actor, id, [assignee]);
      return this.detail(tx, actor, await this.load(tx, id));
    });
  }

  updateItem(
    actor: RequestAuth,
    id: string,
    itemId: string,
    body: UpdateChecklistItemRequest,
  ): Promise<ChecklistDetail> {
    return this.db.tx(async (tx) => {
      const row = await this.editable(tx, actor, id);
      const item = row.items.find((i) => i.id === itemId);
      if (!item) throw notFound('Checklist item');
      const assignee =
        body.assigneeEmployeeId === undefined
          ? undefined
          : await this.assignable(tx, body.assigneeEmployeeId);
      await tx.checklistItem.update({
        where: { id: itemId },
        data: {
          title: body.title,
          description: body.description,
          responsible: body.responsible,
          dueDate: body.dueDate === undefined ? undefined : dateIn(body.dueDate),
          assigneeEmployeeId: assignee,
          // A new date or person is reminded again (ADR 0040, follow-ups).
          ...(changedReminder(item, body.dueDate, assignee) ? { remindedAt: null } : {}),
        },
      });
      if (assignee && assignee !== item.assigneeEmployeeId && !item.doneAt) {
        await this.notify(tx, actor, id, [assignee]);
      }
      return this.detail(tx, actor, await this.load(tx, id));
    });
  }

  deleteItem(actor: RequestAuth, id: string, itemId: string): Promise<ChecklistDetail> {
    return this.db.tx(async (tx) => {
      const row = await this.editable(tx, actor, id);
      if (!row.items.some((i) => i.id === itemId)) throw notFound('Checklist item');
      await tx.checklistItem.delete({ where: { id: itemId } });
      await this.syncStatus(tx, id);
      return this.detail(tx, actor, await this.load(tx, id));
    });
  }

  tick(actor: RequestAuth, id: string, itemId: string, done: boolean): Promise<ChecklistDetail> {
    return this.db.tx(async (tx) => {
      // Lock the checklist so two last ticks agree on its status.
      await this.lockChecklist(tx, id);
      const row = await this.findVisible(tx, actor, id);
      const item = row.items.find((i) => i.id === itemId);
      if (!item) throw notFound('Checklist item');
      const me = await this.me(tx, actor);
      if (!(await this.mayTick(actor, me, row.employeeId, item.assigneeEmployeeId))) {
        throw forbidden('Not your item');
      }
      if (row.status === 'cancelled') throw conflict('status', 'The checklist was cancelled');
      if (done !== (item.doneAt !== null)) {
        if (done && !me) throw forbidden('An employee record is needed to tick items');
        await tx.checklistItem.update({
          where: { id: itemId },
          data: done
            ? { doneAt: new Date(), doneByEmployeeId: me }
            : { doneAt: null, doneByEmployeeId: null },
        });
        await this.syncStatus(tx, id);
      }
      return this.detail(tx, actor, await this.load(tx, id));
    });
  }

  /** Open items waiting for the caller: assigned to them, and HR-group items for the HR group. */
  mine(actor: RequestAuth): Promise<MyChecklistItemList> {
    return this.db.tx(async (tx) => {
      const me = await this.me(tx, actor);
      const hrGroup = actor.permissions['checklist.manage'] === 'all';
      const rows = await tx.checklistItem.findMany({
        where: {
          doneAt: null,
          checklist: { status: 'open' },
          OR: [
            { assigneeEmployeeId: me ?? NONE },
            ...(hrGroup ? [{ assigneeEmployeeId: null }] : []),
          ],
        },
        select: {
          ...ITEM_SELECT,
          checklist: {
            select: { id: true, kind: true, employeeId: true, employee: { select: PERSON } },
          },
        },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: 200,
      });
      const manages = await this.authz.allowedEmployees(actor, 'checklist.manage', [
        ...new Set(rows.map((r) => r.checklist.employeeId)),
      ]);
      return {
        items: rows.map((r) => ({
          ...this.item(r, actor, me, manages.has(r.checklist.employeeId)),
          checklist: {
            id: r.checklist.id,
            kind: r.checklist.kind as ChecklistKind,
            employee: person(r.checklist.employee),
          },
          mine: me !== null && r.assigneeEmployeeId === me,
        })),
      };
    });
  }

  // ----- hooks of the employee lifecycle (called inside their transaction) ----------------------

  /** A new employee: the default onboarding template starts (none = nothing). */
  async onEmployeeCreated(tx: TenantTx, actorUserId: string, employeeId: string): Promise<void> {
    await this.startDefault(tx, actorUserId, employeeId, 'onboarding');
  }

  /**
   * Somebody leaves: their open onboarding is cancelled, their open items on other people's checklists fall back
   * to the HR group, and the default offboarding template starts.
   */
  async onEmployeeDeactivated(
    tx: TenantTx,
    actorUserId: string,
    employeeId: string,
  ): Promise<void> {
    await tx.checklist.updateMany({
      where: { employeeId, kind: 'onboarding', status: 'open' },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    await tx.checklistItem.updateMany({
      where: {
        assigneeEmployeeId: employeeId,
        doneAt: null,
        checklist: { employeeId: { not: employeeId }, status: 'open' },
      },
      data: { assigneeEmployeeId: null, remindedAt: null },
    });
    await this.startDefault(tx, actorUserId, employeeId, 'offboarding');
  }

  // ----- helpers -------------------------------------------------------------------------------

  private async startDefault(
    tx: TenantTx,
    actorUserId: string,
    employeeId: string,
    kind: ChecklistKind,
  ): Promise<void> {
    const template = await tx.checklistTemplate.findFirst({
      where: { kind, isDefault: true },
      select: TEMPLATE_SELECT,
    });
    if (!template) return;
    const open = await tx.checklist.count({ where: { employeeId, kind, status: 'open' } });
    if (open > 0) return;
    await this.startFrom(tx, actorUserId, employeeId, template, undefined);
  }

  /** Copies the template's items with resolved assignees and due dates; notifies the assignees. */
  private async startFrom(
    tx: TenantTx,
    actorUserId: string,
    employeeId: string,
    template: TemplateRow,
    anchorDate: string | undefined,
  ): Promise<string> {
    const subject = await tx.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { hireDate: true, terminationDate: true },
    });
    const anchor =
      anchorDate ??
      (template.kind === 'onboarding'
        ? subject.hireDate && dateOut(subject.hireDate)
        : subject.terminationDate && dateOut(subject.terminationDate)) ??
      (await workspaceToday(tx, this.context));
    const created = await guardUnique(
      () =>
        tx.checklist.create({
          data: {
            employeeId,
            kind: template.kind,
            name: template.name,
            anchorDate: dateIn(anchor),
          },
          select: { id: true },
        }),
      'open',
    );
    const assignees = new Map<ChecklistResponsible, string | null>();
    for (const responsible of ['employee', 'manager', 'hr'] as const) {
      assignees.set(responsible, await this.resolve(tx, employeeId, responsible));
    }
    if (template.items.length > 0) {
      await tx.checklistItem.createMany({
        data: template.items.map((item, position) => ({
          checklistId: created.id,
          title: item.title,
          description: item.description,
          responsible: item.responsible,
          assigneeEmployeeId: assignees.get(item.responsible as ChecklistResponsible) ?? null,
          dueDate: dateIn(checklistDueDate(anchor, item.offsetDays)),
          position,
        })),
      });
    }
    await this.audit.record(tx, {
      actorUserId,
      action: 'checklist.started',
      entity: 'checklist',
      entityId: created.id,
      after: { employeeId, kind: template.kind, templateId: template.id },
    });
    const given = template.items
      .map((item) => assignees.get(item.responsible as ChecklistResponsible))
      .filter((id): id is string => Boolean(id));
    await this.notify(tx, { userId: actorUserId }, created.id, given);
    return created.id;
  }

  /** The person for a responsible: the subject, their active manager, or nobody (the HR group). */
  private async resolve(
    tx: TenantTx,
    employeeId: string,
    responsible: ChecklistResponsible,
  ): Promise<string | null> {
    if (responsible === 'hr') return null;
    const subject = await tx.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { id: true, manager: { select: { id: true, status: true } } },
    });
    if (responsible === 'employee') return subject.id;
    return subject.manager?.status === 'active' ? subject.manager.id : null;
  }

  /** An assignee chosen by hand: an active employee of the workspace, or null for the HR group. */
  private async assignable(tx: TenantTx, employeeId: string | null): Promise<string | null> {
    if (employeeId === null) return null;
    const found = await tx.employee.findFirst({
      where: { id: employeeId, status: 'active' },
      select: { id: true },
    });
    if (!found) throw invalid('assigneeEmployeeId', 'unknown_employee', 'Unknown employee');
    return found.id;
  }

  /** One notification per assignee with an account, counting their items; never the actor. */
  private async notify(
    tx: TenantTx,
    actor: { userId: string },
    checklistId: string,
    assigneeIds: readonly string[],
  ): Promise<void> {
    const counts = new Map<string, number>();
    for (const id of assigneeIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    if (counts.size === 0) return;
    const people = await tx.employee.findMany({
      where: { id: { in: [...counts.keys()] }, status: 'active', userId: { not: null } },
      select: { id: true, userId: true },
    });
    for (const p of people) {
      if (!p.userId || p.userId === actor.userId) continue;
      await this.outbox.publish(tx, 'checklist.assigned', {
        recipientUserId: p.userId,
        checklistId,
        count: counts.get(p.id) ?? 1,
      });
    }
  }

  private async syncStatus(tx: TenantTx, id: string): Promise<void> {
    const row = await tx.checklist.findUniqueOrThrow({
      where: { id },
      select: { status: true, items: { select: { doneAt: true } } },
    });
    const next = checklistStatusFor(
      row.status as ChecklistStatus,
      row.items.map((i) => ({ done: i.doneAt !== null })),
    );
    if (next === row.status) return;
    await tx.checklist.update({
      where: { id },
      data: { status: next, completedAt: next === 'done' ? new Date() : null },
    });
  }

  /** Checklists about people in the caller's view scope, plus those with an item assigned to them. */
  private async visibleWhere(
    tx: TenantTx,
    actor: RequestAuth,
  ): Promise<Prisma.ChecklistWhereInput> {
    const me = await this.me(tx, actor);
    const assigned: Prisma.ChecklistWhereInput = {
      items: { some: { assigneeEmployeeId: me ?? NONE } },
    };
    const scope = actor.permissions['checklist.view'];
    if (scope === 'all') return {};
    const hrGroup = actor.permissions['checklist.manage'] === 'all';
    if (hrGroup) return {};
    if (!scope) return assigned;
    const everyone = (await tx.employee.findMany({ select: { id: true } })).map((e) => e.id);
    const allowed = [...(await this.authz.allowedEmployees(actor, 'checklist.view', everyone))];
    return { OR: [assigned, ...(allowed.length > 0 ? [{ employeeId: { in: allowed } }] : [])] };
  }

  private async findVisible(tx: TenantTx, actor: RequestAuth, id: string): Promise<ChecklistRow> {
    const row = await tx.checklist.findFirst({
      where: { AND: [{ id }, await this.visibleWhere(tx, actor)] },
      select: CHECKLIST_SELECT,
    });
    if (!row) throw notFound('Checklist');
    return row;
  }

  private load(tx: TenantTx, id: string): Promise<ChecklistRow> {
    return tx.checklist.findUniqueOrThrow({ where: { id }, select: CHECKLIST_SELECT });
  }

  /** A checklist the caller may edit: visible, managed by them, not cancelled. */
  private async editable(tx: TenantTx, actor: RequestAuth, id: string): Promise<ChecklistRow> {
    await this.lockChecklist(tx, id);
    const row = await this.findVisible(tx, actor, id);
    await this.assertManages(actor, row.employeeId);
    if (row.status === 'cancelled') throw conflict('status', 'The checklist was cancelled');
    return row;
  }

  private async lockChecklist(tx: TenantTx, id: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checklist:${id}`}))`;
  }

  private async assertManages(actor: RequestAuth, employeeId: string): Promise<void> {
    if (await this.authz.can(actor, 'checklist.manage', { ownerEmployeeId: employeeId })) return;
    throw forbidden('Not allowed: checklist.manage');
  }

  private async mayTick(
    actor: RequestAuth,
    me: string | null,
    subjectId: string,
    assigneeId: string | null,
  ): Promise<boolean> {
    if (me !== null && assigneeId === me) return true;
    if (assigneeId === null && actor.permissions['checklist.manage'] === 'all') return true;
    return this.authz.can(actor, 'checklist.manage', { ownerEmployeeId: subjectId });
  }

  private async me(tx: TenantTx, actor: RequestAuth): Promise<string | null> {
    const found = await tx.employee.findFirst({
      where: { userId: actor.userId },
      select: { id: true },
    });
    return found?.id ?? null;
  }

  private assertReadsTemplates(actor: RequestAuth): void {
    if (actor.permissions['checklist.manage'] || actor.permissions['checklist.manage_templates'])
      return;
    throw forbidden('Not allowed: checklist templates');
  }

  private async findTemplate(tx: TenantTx, id: string): Promise<TemplateRow> {
    const row = await tx.checklistTemplate.findUnique({ where: { id }, select: TEMPLATE_SELECT });
    if (!row) throw notFound('Checklist template');
    return row;
  }

  private async lockTemplates(tx: TenantTx): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checklist-templates:${this.context.requireTenantId()}`}))`;
  }

  private async clearDefault(tx: TenantTx, kind: ChecklistKind): Promise<void> {
    await tx.checklistTemplate.updateMany({
      where: { kind, isDefault: true },
      data: { isDefault: false },
    });
  }

  private async writeTemplateItems(
    tx: TenantTx,
    templateId: string,
    items: TemplateRequest['items'],
  ): Promise<void> {
    if (items.length === 0) return;
    await tx.checklistTemplateItem.createMany({
      data: items.map((item, position) => ({ templateId, ...item, position })),
    });
  }

  private presentTemplate(actor: RequestAuth, row: TemplateRow): ChecklistTemplate {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as ChecklistKind,
      isDefault: row.isDefault,
      items: row.items.map((item) => ({
        ...item,
        responsible: item.responsible as ChecklistResponsible,
      })),
      canEdit: Boolean(actor.permissions['checklist.manage_templates']),
    };
  }

  private item(
    row: ItemRow,
    actor: RequestAuth,
    me: string | null,
    manages: boolean,
  ): ChecklistItem {
    const canTick =
      manages ||
      (me !== null && row.assigneeEmployeeId === me) ||
      (row.assigneeEmployeeId === null && actor.permissions['checklist.manage'] === 'all');
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      responsible: row.responsible as ChecklistResponsible,
      assignee: row.assignee ? person(row.assignee) : null,
      dueDate: dateOut(row.dueDate),
      done: row.doneAt !== null,
      doneAt: row.doneAt?.toISOString() ?? null,
      doneBy: row.doneBy ? person(row.doneBy) : null,
      canTick,
    };
  }

  private summary(row: ChecklistRow, today: string): ChecklistSummary {
    const items = row.items.map((i) => ({ dueDate: dateOut(i.dueDate), done: i.doneAt !== null }));
    return {
      id: row.id,
      employee: person(row.employee),
      kind: row.kind as ChecklistKind,
      name: row.name,
      anchorDate: dateOut(row.anchorDate),
      status: row.status as ChecklistStatus,
      done: items.filter((i) => i.done).length,
      total: items.length,
      overdue:
        row.status === 'open'
          ? items.filter((i) => checklistItemState(i, today) === 'overdue').length
          : 0,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async detail(
    tx: TenantTx,
    actor: RequestAuth,
    row: ChecklistRow,
  ): Promise<ChecklistDetail> {
    const [today, me, manages] = await Promise.all([
      workspaceToday(tx, this.context),
      this.me(tx, actor),
      this.authz.can(actor, 'checklist.manage', { ownerEmployeeId: row.employeeId }),
    ]);
    const open = row.status !== 'cancelled';
    return {
      ...this.summary(row, today),
      items: row.items.map((i) => {
        const item = this.item(i, actor, me, manages);
        return { ...item, canTick: open && item.canTick };
      }),
      completedAt: row.completedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      canManage: manages && open,
    };
  }
}

/** Whether an item update moves its due date or hands it to someone else. */
function changedReminder(
  item: { dueDate: Date; assigneeEmployeeId: string | null },
  dueDate: string | undefined,
  assignee: string | null | undefined,
): boolean {
  const movedDate = dueDate !== undefined && dateIn(dueDate).getTime() !== item.dueDate.getTime();
  const newPerson = assignee !== undefined && assignee !== item.assigneeEmployeeId;
  return movedDate || newPerson;
}
