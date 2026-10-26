import { Injectable } from '@nestjs/common';
import {
  MAX_ACTION_ITEMS,
  isActionItemOverdue,
  utcToZoned,
  zonedToUtc,
  type ActionItem,
  type CreateActionItemRequest,
  type CreateOneOnOneRequest,
  type OneOnOneDetail,
  type OneOnOneList,
  type OneOnOnePeople,
  type OneOnOneQuery,
  type OneOnOneStatus,
  type OneOnOneSummary,
  type UpdateActionItemRequest,
  type UpdateOneOnOneRequest,
} from '@intime/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import {
  dateIn,
  dateOut,
  conflict,
  forbidden,
  invalid,
  notFound,
} from '../projects/projects.shared.js';
import { workspaceToday } from '../projects/projects.present.js';

const PERSON = { id: true, firstName: true, lastName: true, userId: true } as const;

const SELECT = {
  id: true,
  managerEmployeeId: true,
  employeeId: true,
  scheduledAt: true,
  durationMinutes: true,
  status: true,
  agenda: true,
  sharedNotes: true,
  privateNotesManager: true,
  privateNotesEmployee: true,
  manager: { select: PERSON },
  employee: { select: PERSON },
  actionItems: {
    select: {
      id: true,
      title: true,
      dueDate: true,
      doneAt: true,
      owner: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.OneOnOneSelect;
type Row = Prisma.OneOnOneGetPayload<{ select: typeof SELECT }>;

const name = (p: { id: string; firstName: string; lastName: string }) => ({
  id: p.id,
  firstName: p.firstName,
  lastName: p.lastName,
});

/** 1:1 meetings between a person and their manager (docs/adr/0020-one-on-ones.md). */
@Injectable()
export class OneOnOnesService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
    private readonly outbox: OutboxService,
  ) {}

  people(actor: RequestAuth): Promise<OneOnOnePeople> {
    return this.db.tx(async (tx) => {
      const me = await this.me(tx, actor);
      const me2 = await tx.employee.findUniqueOrThrow({
        where: { id: me },
        select: {
          manager: { select: { id: true, firstName: true, lastName: true, status: true } },
        },
      });
      const reports = await tx.employee.findMany({
        where: { managerId: me, status: 'active' },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        select: { id: true, firstName: true, lastName: true },
      });
      const allowed = await this.authz.allowedEmployees(
        actor,
        'one_on_one.manage',
        reports.map((r) => r.id),
      );
      const items: OneOnOnePeople['items'] = [];
      if (me2.manager?.status === 'active') {
        items.push({ ...name(me2.manager), relation: 'manager' });
      }
      for (const r of reports)
        if (allowed.has(r.id)) items.push({ ...name(r), relation: 'report' });
      return { items };
    });
  }

  list(actor: RequestAuth, query: OneOnOneQuery): Promise<OneOnOneList> {
    return this.db.tx(async (tx) => {
      const me = await this.me(tx, actor);
      const where: Prisma.OneOnOneWhereInput = {
        AND: [
          { OR: [{ managerEmployeeId: me }, { employeeId: me }] },
          query.status === 'upcoming'
            ? { status: 'scheduled' }
            : query.status === 'past'
              ? { status: { in: ['done', 'cancelled'] } }
              : {},
        ],
      };
      const [rows, total, zone] = await Promise.all([
        tx.oneOnOne.findMany({
          where,
          select: SELECT,
          orderBy: [{ scheduledAt: query.status === 'upcoming' ? 'asc' : 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.oneOnOne.count({ where }),
        this.zone(tx),
      ]);
      return {
        items: rows.map((row) => this.summary(row, me, zone)),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  get(actor: RequestAuth, id: string): Promise<OneOnOneDetail> {
    return this.db.tx(async (tx) => {
      const me = await this.me(tx, actor);
      return this.detail(tx, me, await this.find(tx, me, id));
    });
  }

  create(actor: RequestAuth, body: CreateOneOnOneRequest): Promise<OneOnOneDetail> {
    return this.db.tx(async (tx) => {
      const me = await this.me(tx, actor);
      const targetId = body.employeeId ?? me;
      const target = await tx.employee.findFirst({
        where: { id: targetId, status: 'active' },
        select: { id: true, managerId: true, manager: { select: { status: true } } },
      });
      if (!target) {
        throw invalid(
          'employeeId',
          'unknown_employee',
          'This person does not exist or is not active',
        );
      }
      if (!(await this.authz.can(actor, 'one_on_one.manage', { ownerEmployeeId: targetId }))) {
        throw forbidden('Not allowed to schedule a 1:1 with this person');
      }
      if (targetId === me) {
        if (!target.managerId || target.manager?.status !== 'active') {
          throw invalid('employeeId', 'no_manager', 'You have no manager to meet');
        }
      } else if (target.managerId !== me) {
        throw forbidden('You can schedule a 1:1 with your own manager or a direct report only');
      }
      const zone = await this.zone(tx);
      const scheduledAt = this.instant(body.date, body.time, zone);
      const created = await tx.oneOnOne.create({
        data: {
          managerEmployeeId: targetId === me ? target.managerId! : me,
          employeeId: targetId,
          scheduledAt,
          durationMinutes: body.durationMinutes,
          agenda: body.agenda ?? null,
        },
        select: { id: true },
      });
      const row = await this.find(tx, me, created.id);
      await this.notify(tx, row, me, 'scheduled', body.date);
      return this.detail(tx, me, row);
    });
  }

  update(actor: RequestAuth, id: string, body: UpdateOneOnOneRequest): Promise<OneOnOneDetail> {
    return this.db.tx(async (tx) => {
      const me = await this.me(tx, actor);
      const row = await this.find(tx, me, id);
      this.assertOpen(row);
      const zone = await this.zone(tx);
      const isManager = row.managerEmployeeId === me;
      const data: Prisma.OneOnOneUpdateInput = {
        ...(body.durationMinutes !== undefined ? { durationMinutes: body.durationMinutes } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.agenda !== undefined ? { agenda: body.agenda } : {}),
        ...(body.sharedNotes !== undefined ? { sharedNotes: body.sharedNotes } : {}),
        ...(body.privateNotes !== undefined
          ? isManager
            ? { privateNotesManager: body.privateNotes }
            : { privateNotesEmployee: body.privateNotes }
          : {}),
      };
      let rescheduledTo: string | null = null;
      if (body.date !== undefined && body.time !== undefined) {
        const next = this.instant(body.date, body.time, zone);
        if (next.getTime() !== row.scheduledAt.getTime()) {
          data.scheduledAt = next;
          rescheduledTo = body.date;
        }
      }
      await tx.oneOnOne.update({ where: { id }, data });
      if (body.status === 'cancelled') {
        await this.notify(tx, row, me, 'cancelled', utcToZoned(row.scheduledAt, zone).date);
      } else if (rescheduledTo) {
        await this.notify(tx, row, me, 'rescheduled', rescheduledTo);
      }
      return this.detail(tx, me, await this.find(tx, me, id));
    });
  }

  addActionItem(
    actor: RequestAuth,
    id: string,
    body: CreateActionItemRequest,
  ): Promise<OneOnOneDetail> {
    return this.db.tx(async (tx) => {
      const me = await this.me(tx, actor);
      const row = await this.find(tx, me, id);
      this.assertOpen(row);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const count = await tx.oneOnOneActionItem.count({ where: { oneOnOneId: id } });
      if (count >= MAX_ACTION_ITEMS) {
        throw invalid('title', 'too_many', 'A meeting holds at most 20 action items');
      }
      const owner = body.ownerEmployeeId ?? me;
      this.assertParticipant(row, owner);
      await tx.oneOnOneActionItem.create({
        data: {
          oneOnOneId: id,
          ownerEmployeeId: owner,
          title: body.title,
          dueDate: body.dueDate ? dateIn(body.dueDate) : null,
        },
      });
      return this.detail(tx, me, await this.find(tx, me, id));
    });
  }

  updateActionItem(
    actor: RequestAuth,
    id: string,
    itemId: string,
    body: UpdateActionItemRequest,
  ): Promise<OneOnOneDetail> {
    return this.db.tx(async (tx) => {
      const me = await this.me(tx, actor);
      const row = await this.find(tx, me, id);
      this.assertOpen(row);
      const item = row.actionItems.find((i) => i.id === itemId);
      if (!item) throw notFound('Action item');
      if (body.ownerEmployeeId) this.assertParticipant(row, body.ownerEmployeeId);
      await tx.oneOnOneActionItem.update({
        where: { id: itemId },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.ownerEmployeeId !== undefined ? { ownerEmployeeId: body.ownerEmployeeId } : {}),
          ...(body.dueDate !== undefined
            ? { dueDate: body.dueDate ? dateIn(body.dueDate) : null }
            : {}),
          ...(body.done !== undefined
            ? { doneAt: body.done ? (item.doneAt ?? new Date()) : null }
            : {}),
        },
      });
      return this.detail(tx, me, await this.find(tx, me, id));
    });
  }

  removeActionItem(actor: RequestAuth, id: string, itemId: string): Promise<OneOnOneDetail> {
    return this.db.tx(async (tx) => {
      const me = await this.me(tx, actor);
      const row = await this.find(tx, me, id);
      this.assertOpen(row);
      if (!row.actionItems.some((i) => i.id === itemId)) throw notFound('Action item');
      await tx.oneOnOneActionItem.delete({ where: { id: itemId } });
      return this.detail(tx, me, await this.find(tx, me, id));
    });
  }

  // ----- hooks of the employee lifecycle (called inside their transaction) ----------------------

  /** Somebody leaves: their planned meetings are cancelled; held ones stay. */
  async onEmployeeDeactivated(tx: TenantTx, employeeId: string): Promise<void> {
    await tx.oneOnOne.updateMany({
      where: {
        status: 'scheduled',
        OR: [{ managerEmployeeId: employeeId }, { employeeId }],
      },
      data: { status: 'cancelled' },
    });
  }

  /** A new manager does not inherit planned meetings of the old one (ADR 0020). */
  async onManagerChanged(
    tx: TenantTx,
    employeeId: string,
    newManagerId: string | null,
  ): Promise<void> {
    await tx.oneOnOne.updateMany({
      where: {
        status: 'scheduled',
        employeeId,
        ...(newManagerId ? { managerEmployeeId: { not: newManagerId } } : {}),
      },
      data: { status: 'cancelled' },
    });
  }

  // ----- helpers -------------------------------------------------------------------------------

  private async me(tx: TenantTx, actor: RequestAuth): Promise<string> {
    const employee = await tx.employee.findFirst({
      where: { userId: actor.userId, status: 'active' },
      select: { id: true },
    });
    if (!employee) throw forbidden('Only employees have 1:1 meetings');
    return employee.id;
  }

  private async zone(tx: TenantTx): Promise<string> {
    const tenant = await tx.tenant.findUnique({
      where: { id: this.context.requireTenantId() },
      select: { defaultTimezone: true },
    });
    return tenant?.defaultTimezone ?? 'UTC';
  }

  private instant(date: string, time: string, zone: string): Date {
    const at = zonedToUtc(date, time, zone);
    if (!at) throw invalid('time', 'nonexistent_time', 'This time does not exist on that day');
    return at;
  }

  /** A meeting is visible to its two people only; everybody else gets 404. */
  private async find(tx: TenantTx, me: string, id: string): Promise<Row> {
    const row = await tx.oneOnOne.findFirst({
      where: { id, OR: [{ managerEmployeeId: me }, { employeeId: me }] },
      select: SELECT,
    });
    if (!row) throw notFound('Meeting');
    return row;
  }

  private assertOpen(row: Row): void {
    if (row.status === 'cancelled') throw conflict('status', 'The meeting is cancelled');
  }

  private assertParticipant(row: Row, employeeId: string): void {
    if (employeeId !== row.managerEmployeeId && employeeId !== row.employeeId) {
      throw invalid(
        'ownerEmployeeId',
        'not_participant',
        'The owner must take part in the meeting',
      );
    }
  }

  private async notify(
    tx: TenantTx,
    row: Row,
    me: string,
    action: 'scheduled' | 'rescheduled' | 'cancelled',
    date: string,
  ): Promise<void> {
    const other = row.managerEmployeeId === me ? row.employee : row.manager;
    if (!other.userId) return;
    await this.outbox.publish(tx, 'one_on_one.changed', {
      recipientUserId: other.userId,
      meetingId: row.id,
      date,
      action,
    });
  }

  private summary(row: Row, me: string, zone: string): OneOnOneSummary {
    const isManager = row.managerEmployeeId === me;
    const at = utcToZoned(row.scheduledAt, zone);
    return {
      id: row.id,
      other: name(isManager ? row.employee : row.manager),
      role: isManager ? 'manager' : 'employee',
      date: at.date,
      time: at.time,
      durationMinutes: row.durationMinutes,
      status: row.status as OneOnOneStatus,
      openActionItems: row.actionItems.filter((i) => !i.doneAt).length,
    };
  }

  private async detail(tx: TenantTx, me: string, row: Row): Promise<OneOnOneDetail> {
    const [zone, today] = await Promise.all([this.zone(tx), workspaceToday(tx, this.context)]);
    const isManager = row.managerEmployeeId === me;
    const items: ActionItem[] = row.actionItems.map((i) => {
      const dueDate = i.dueDate ? dateOut(i.dueDate) : null;
      const done = i.doneAt !== null;
      return {
        id: i.id,
        title: i.title,
        owner: name(i.owner),
        dueDate,
        done,
        overdue: isActionItemOverdue({ dueDate, done }, today),
      };
    });
    return {
      ...this.summary(row, me, zone),
      manager: name(row.manager),
      employee: name(row.employee),
      agenda: row.agenda,
      sharedNotes: row.sharedNotes,
      privateNotes: isManager ? row.privateNotesManager : row.privateNotesEmployee,
      actionItems: items,
      canEdit: row.status !== 'cancelled',
    };
  }
}
