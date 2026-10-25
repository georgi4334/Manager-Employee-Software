import { Injectable } from '@nestjs/common';
import {
  isOverdue,
  taskKey,
  type CreateTaskRequest,
  type Task,
  type TaskList,
  type TaskQuery,
  type UpdateTaskRequest,
} from '@intime/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import { ProjectAccess } from './project-access.service.js';
import { workspaceToday } from './projects.present.js';
import { dateIn, dateOut, escapeLike, forbidden, invalid, notFound } from './projects.shared.js';
import { ProjectsService } from './projects.service.js';

const SELECT = {
  id: true,
  number: true,
  projectId: true,
  milestoneId: true,
  title: true,
  description: true,
  type: true,
  status: true,
  priority: true,
  assigneeEmployeeId: true,
  estimateHours: true,
  dueDate: true,
  doneOn: true,
  project: { select: { id: true, code: true, name: true, leadEmployeeId: true } },
  milestone: { select: { id: true, title: true } },
  assignee: { select: { id: true, firstName: true, lastName: true, userId: true } },
} satisfies Prisma.TaskSelect;
type Row = Prisma.TaskGetPayload<{ select: typeof SELECT }>;

const KEY = /^(.+)-(\d+)$/;

/** Lean tasks (docs/adr/0014-tasks.md): leads manage them, the assignee moves their own along. */
@Injectable()
export class TasksService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly access: ProjectAccess,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  list(actor: RequestAuth, query: TaskQuery): Promise<TaskList> {
    return this.db.tx(async (tx) => {
      const visible = await this.visibleWhere(tx, actor);
      const me = await this.access.ownEmployeeId(tx, actor);
      const words = (query.q ?? '').split(/\s+/).filter(Boolean).slice(0, 5);
      const where: Prisma.TaskWhereInput = {
        AND: [
          visible,
          query.projectId ? { projectId: query.projectId } : {},
          query.status === 'all'
            ? {}
            : query.status === 'open'
              ? { status: { not: 'done' } }
              : { status: query.status },
          query.type === 'all' ? {} : { type: query.type },
          query.assignee === 'none'
            ? { assigneeEmployeeId: null }
            : query.assignee === 'me'
              ? { assigneeEmployeeId: me ?? '00000000-0000-0000-0000-000000000000' }
              : query.assignee
                ? { assigneeEmployeeId: query.assignee }
                : {},
          ...words.map((word) => {
            const reference = KEY.exec(word);
            return {
              OR: [
                { title: { contains: escapeLike(word), mode: 'insensitive' as const } },
                ...(reference
                  ? [
                      {
                        number: Number(reference[2]),
                        project: { code: { equals: reference[1]!, mode: 'insensitive' as const } },
                      },
                    ]
                  : []),
              ],
            };
          }),
        ],
      };
      const [rows, total] = await Promise.all([
        tx.task.findMany({
          where,
          select: SELECT,
          orderBy: [{ project: { code: 'asc' } }, { number: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.task.count({ where }),
      ]);
      const items = await this.present(tx, actor, rows, me);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  get(actor: RequestAuth, id: string): Promise<Task> {
    return this.db.tx(async (tx) => {
      const row = await this.findVisible(tx, actor, id);
      return (await this.present(tx, actor, [row]))[0]!;
    });
  }

  create(actor: RequestAuth, projectId: string, body: CreateTaskRequest): Promise<Task> {
    return this.db.tx(async (tx) => {
      const project = await this.projects.findVisible(tx, actor, projectId);
      if (!(await this.mayEditOnProject(actor, project.leadEmployeeId))) {
        throw forbidden('Only the project lead, HR or an administrator can create tasks');
      }
      const assignee = await this.checkAssignee(
        tx,
        projectId,
        project.leadEmployeeId,
        body.assigneeEmployeeId,
      );
      if (body.milestoneId) await this.checkMilestone(tx, projectId, body.milestoneId);

      // The project row lock serialises the numbering of simultaneous requests.
      const { taskSeq } = await tx.project.update({
        where: { id: projectId },
        data: { taskSeq: { increment: 1 } },
        select: { taskSeq: true },
      });
      const today = await workspaceToday(tx, this.context);
      const created = await tx.task.create({
        data: {
          projectId,
          number: taskSeq,
          milestoneId: body.milestoneId ?? null,
          title: body.title,
          description: body.description ?? null,
          type: body.type,
          status: body.status,
          priority: body.priority,
          assigneeEmployeeId: assignee?.id ?? null,
          estimateHours: body.estimateHours ?? null,
          dueDate: body.dueDate ? dateIn(body.dueDate) : null,
          doneOn: body.status === 'done' ? dateIn(today) : null,
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'task.created',
        entity: 'task',
        entityId: created.id,
        after: { projectId },
      });
      if (assignee) await this.notify(tx, actor, assignee, projectId, project.code, taskSeq);
      return (await this.present(tx, actor, [await this.find(tx, created.id)]))[0]!;
    });
  }

  update(actor: RequestAuth, id: string, body: UpdateTaskRequest): Promise<Task> {
    return this.db.tx(async (tx) => {
      const row = await this.findVisible(tx, actor, id);
      const me = await this.access.ownEmployeeId(tx, actor);
      const canEdit = await this.mayEditOnProject(actor, row.project.leadEmployeeId);
      const onlyStatus = Object.keys(body).length === 1 && body.status !== undefined;
      if (!canEdit && !(onlyStatus && this.mayMove(actor, row, me))) {
        throw forbidden('Not allowed to change this task');
      }

      let assignee: { id: string; userId: string | null } | null | undefined;
      if (
        body.assigneeEmployeeId !== undefined &&
        body.assigneeEmployeeId !== row.assigneeEmployeeId
      ) {
        assignee = await this.checkAssignee(
          tx,
          row.projectId,
          row.project.leadEmployeeId,
          body.assigneeEmployeeId ?? undefined,
        );
      }
      if (body.milestoneId && body.milestoneId !== row.milestoneId) {
        await this.checkMilestone(tx, row.projectId, body.milestoneId);
      }
      const today = await workspaceToday(tx, this.context);
      await tx.task.update({
        where: { id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.milestoneId !== undefined ? { milestoneId: body.milestoneId } : {}),
          ...(body.assigneeEmployeeId !== undefined
            ? { assigneeEmployeeId: body.assigneeEmployeeId }
            : {}),
          ...(body.estimateHours !== undefined ? { estimateHours: body.estimateHours } : {}),
          ...(body.dueDate !== undefined
            ? { dueDate: body.dueDate ? dateIn(body.dueDate) : null }
            : {}),
          ...(body.status !== undefined && body.status !== row.status
            ? { status: body.status, doneOn: body.status === 'done' ? dateIn(today) : null }
            : {}),
        },
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'task.updated',
        entity: 'task',
        entityId: id,
        after: { fields: Object.keys(body).sort() },
      });
      if (assignee) {
        await this.notify(tx, actor, assignee, row.projectId, row.project.code, row.number);
      }
      return (await this.present(tx, actor, [await this.find(tx, id)], me))[0]!;
    });
  }

  remove(actor: RequestAuth, id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const row = await this.findVisible(tx, actor, id);
      if (!(await this.mayEditOnProject(actor, row.project.leadEmployeeId))) {
        throw forbidden('Only the project lead, HR or an administrator can delete tasks');
      }
      await tx.task.delete({ where: { id } });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'task.deleted',
        entity: 'task',
        entityId: id,
        after: { projectId: row.projectId },
      });
    });
  }

  // ----- rules ---------------------------------------------------------------------------------

  /** Tasks of the projects the caller sees through the task scope, and tasks given to people inside it. */
  private async visibleWhere(tx: TenantTx, actor: RequestAuth): Promise<Prisma.TaskWhereInput> {
    const scope = actor.permissions['task.view'];
    if (!scope) return { id: { in: [] } };
    if (scope === 'all') return {};
    const everyone = (await tx.employee.findMany({ select: { id: true } })).map((e) => e.id);
    const allowed = [...(await this.accessAllowed(actor, everyone))];
    const projectWhere = await this.access.visibleWhere(tx, actor, 'task.view');
    return {
      OR: [
        ...(allowed.length > 0 ? [{ assigneeEmployeeId: { in: allowed } }] : []),
        { project: projectWhere },
      ],
    };
  }

  private accessAllowed(actor: RequestAuth, ids: readonly string[]) {
    return this.access.allowed(actor, 'task.view', ids);
  }

  /** May change every field: holds task.manage, and either scope "all" or leads the project (project.manage covers the lead). */
  private async mayEditOnProject(
    actor: RequestAuth,
    leadEmployeeId: string | null,
  ): Promise<boolean> {
    const scope = actor.permissions['task.manage'];
    if (!scope) return false;
    if (scope === 'all') return true;
    return this.access.can(actor, 'project.manage', leadEmployeeId);
  }

  /** The assignee moves their own task along (status only). */
  private mayMove(actor: RequestAuth, row: Row, me: string | null): boolean {
    return (
      Boolean(actor.permissions['task.manage']) && me !== null && row.assigneeEmployeeId === me
    );
  }

  /** An active employee staffed on the project (any period) or its lead. */
  private async checkAssignee(
    tx: TenantTx,
    projectId: string,
    leadEmployeeId: string | null,
    employeeId: string | undefined,
  ): Promise<{ id: string; userId: string | null } | null> {
    if (!employeeId) return null;
    const employee = await tx.employee.findFirst({
      where: { id: employeeId, status: 'active' },
      select: { id: true, userId: true },
    });
    if (!employee) {
      throw invalid(
        'assigneeEmployeeId',
        'unknown_employee',
        'This person does not exist or is not active',
      );
    }
    if (employee.id !== leadEmployeeId) {
      const staffed = await tx.projectAssignment.findFirst({
        where: { projectId, employeeId },
        select: { id: true },
      });
      if (!staffed) {
        throw invalid(
          'assigneeEmployeeId',
          'assignee_not_on_project',
          'This person is not on the project',
        );
      }
    }
    return employee;
  }

  private async checkMilestone(
    tx: TenantTx,
    projectId: string,
    milestoneId: string,
  ): Promise<void> {
    const milestone = await tx.milestone.findFirst({
      where: { id: milestoneId, projectId },
      select: { id: true },
    });
    if (!milestone) {
      throw invalid(
        'milestoneId',
        'milestone_not_in_project',
        'This milestone is not part of the project',
      );
    }
  }

  private async notify(
    tx: TenantTx,
    actor: RequestAuth,
    assignee: { id: string; userId: string | null },
    projectId: string,
    code: string,
    number: number,
  ): Promise<void> {
    if (!assignee.userId || assignee.userId === actor.userId) return;
    await this.outbox.publish(tx, 'task.assigned', {
      recipientUserId: assignee.userId,
      projectId,
      taskKey: taskKey(code, number),
    });
  }

  // ----- helpers -------------------------------------------------------------------------------

  private async find(tx: TenantTx, id: string): Promise<Row> {
    const row = await tx.task.findUnique({ where: { id }, select: SELECT });
    if (!row) throw notFound('Task');
    return row;
  }

  private async findVisible(tx: TenantTx, actor: RequestAuth, id: string): Promise<Row> {
    const visible = await this.visibleWhere(tx, actor);
    const row = await tx.task.findFirst({ where: { AND: [{ id }, visible] }, select: SELECT });
    if (!row) throw notFound('Task');
    return row;
  }

  private async present(
    tx: TenantTx,
    actor: RequestAuth,
    rows: readonly Row[],
    knownMe?: string | null,
  ): Promise<Task[]> {
    if (rows.length === 0) return [];
    const me = knownMe === undefined ? await this.access.ownEmployeeId(tx, actor) : knownMe;
    const today = await workspaceToday(tx, this.context);
    const leads = [
      ...new Set(rows.flatMap((r) => (r.project.leadEmployeeId ? [r.project.leadEmployeeId] : []))),
    ];
    const manage = await this.access.coveredLeads(actor, 'project.manage', leads);
    const holdsManage = Boolean(actor.permissions['task.manage']);
    const allScope = actor.permissions['task.manage'] === 'all';
    return rows.map((row) => {
      const canEdit =
        holdsManage && (allScope || ProjectAccess.covers(manage, row.project.leadEmployeeId));
      const status = row.status as Task['status'];
      const dueDate = row.dueDate ? dateOut(row.dueDate) : null;
      return {
        id: row.id,
        key: taskKey(row.project.code, row.number),
        number: row.number,
        project: { id: row.project.id, code: row.project.code, name: row.project.name },
        milestone: row.milestone,
        title: row.title,
        description: row.description,
        type: row.type as Task['type'],
        status,
        priority: row.priority as Task['priority'],
        assignee: row.assignee
          ? {
              id: row.assignee.id,
              firstName: row.assignee.firstName,
              lastName: row.assignee.lastName,
            }
          : null,
        estimateHours: row.estimateHours === null ? null : Number(row.estimateHours),
        dueDate,
        doneOn: row.doneOn ? dateOut(row.doneOn) : null,
        overdue: isOverdue({ dueDate, status }, today),
        canEdit,
        canMove: canEdit || this.mayMove(actor, row, me),
      };
    });
  }
}
