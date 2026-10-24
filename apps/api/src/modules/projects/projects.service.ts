import { Injectable } from '@nestjs/common';
import {
  projectHealth,
  type CreateProjectRequest,
  type ProjectDetail,
  type ProjectList,
  type ProjectQuery,
  type ProjectSummary,
  type UpdateProjectRequest,
} from '@intime/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ProjectAccess } from './project-access.service.js';
import {
  ASSIGNMENT_SELECT,
  presentAssignments,
  presentMilestone,
  workspaceToday,
} from './projects.present.js';
import {
  PROJECT_SELECT,
  conflict,
  dateIn,
  dateOut,
  escapeLike,
  forbidden,
  guardUnique,
  invalid,
  notFound,
  type ProjectRow,
} from './projects.shared.js';

/** Projects (docs/adr/0013-clients-and-projects.md). Health is computed from the milestones, never stored. */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly access: ProjectAccess,
    private readonly audit: AuditService,
  ) {}

  list(actor: RequestAuth, query: ProjectQuery): Promise<ProjectList> {
    return this.db.tx(async (tx) => {
      const visible = await this.access.visibleWhere(tx, actor);
      const words = (query.q ?? '').split(/\s+/).filter(Boolean).slice(0, 5);
      const where: Prisma.ProjectWhereInput = {
        AND: [
          visible,
          query.status === 'all' ? {} : { status: query.status },
          query.clientId && actor.permissions['client.view'] ? { clientId: query.clientId } : {},
          ...words.map((word) => ({
            OR: [
              { name: { contains: escapeLike(word), mode: 'insensitive' as const } },
              { code: { contains: escapeLike(word), mode: 'insensitive' as const } },
            ],
          })),
        ],
      };
      const [rows, total] = await Promise.all([
        tx.project.findMany({
          where,
          select: PROJECT_SELECT,
          orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.project.count({ where }),
      ]);
      const items = await this.summaries(tx, actor, rows);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  get(actor: RequestAuth, id: string): Promise<ProjectDetail> {
    return this.db.tx(async (tx) => {
      const row = await this.findVisible(tx, actor, id);
      return this.detail(tx, actor, row);
    });
  }

  create(actor: RequestAuth, body: CreateProjectRequest): Promise<ProjectDetail> {
    return this.db.tx(async (tx) => {
      const scope = actor.permissions['project.manage'];
      let lead = body.leadEmployeeId ?? null;
      if (scope !== 'all') {
        // Managers create projects they lead themselves.
        const own = await this.access.ownEmployeeId(tx, actor);
        if (!own) throw notFound('Employee record');
        if (lead && lead !== own)
          throw forbidden('Only HR or an administrator can name another lead');
        lead = own;
      }
      if (lead) await this.assertEmployee(tx, lead, 'leadEmployeeId');
      if (body.clientId) await this.assertClient(tx, actor, body.clientId);

      const created = await guardUnique(
        () =>
          tx.project.create({
            data: {
              code: body.code,
              name: body.name,
              description: body.description ?? null,
              clientId: body.clientId ?? null,
              status: body.status,
              priority: body.priority,
              isBillable: body.isBillable,
              budgetHours: body.budgetHours ?? null,
              startDate: dateIn(body.startDate),
              endDate: body.endDate ? dateIn(body.endDate) : null,
              leadEmployeeId: lead,
            },
            select: { id: true },
          }),
        'code',
      );
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'project.created',
        entity: 'project',
        entityId: created.id,
      });
      return this.detail(tx, actor, await this.row(tx, created.id));
    });
  }

  update(actor: RequestAuth, id: string, body: UpdateProjectRequest): Promise<ProjectDetail> {
    return this.db.tx(async (tx) => {
      const row = await this.findVisible(tx, actor, id);
      await this.assertManage(actor, row);

      const startDate = body.startDate ?? dateOut(row.startDate);
      const endDate =
        body.endDate === undefined ? (row.endDate ? dateOut(row.endDate) : null) : body.endDate;
      if (endDate && endDate < startDate) {
        throw invalid('endDate', 'end_before_start', 'The end cannot be before the start');
      }
      if (body.leadEmployeeId !== undefined && body.leadEmployeeId !== row.leadEmployeeId) {
        if (actor.permissions['project.manage'] !== 'all') {
          throw forbidden('Only HR or an administrator can change the lead');
        }
        if (body.leadEmployeeId)
          await this.assertEmployee(tx, body.leadEmployeeId, 'leadEmployeeId');
      }
      if (body.clientId && body.clientId !== row.clientId) {
        await this.assertClient(tx, actor, body.clientId);
      }
      if (body.clientId === null && row.clientId && !actor.permissions['client.view']) {
        throw forbidden('You cannot change the client of this project');
      }

      await guardUnique(
        () =>
          tx.project.update({
            where: { id },
            data: {
              ...(body.code !== undefined ? { code: body.code } : {}),
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.description !== undefined ? { description: body.description } : {}),
              ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
              ...(body.status !== undefined ? { status: body.status } : {}),
              ...(body.priority !== undefined ? { priority: body.priority } : {}),
              ...(body.isBillable !== undefined ? { isBillable: body.isBillable } : {}),
              ...(body.budgetHours !== undefined ? { budgetHours: body.budgetHours } : {}),
              ...(body.startDate !== undefined ? { startDate: dateIn(body.startDate) } : {}),
              ...(body.endDate !== undefined
                ? { endDate: body.endDate ? dateIn(body.endDate) : null }
                : {}),
              ...(body.leadEmployeeId !== undefined ? { leadEmployeeId: body.leadEmployeeId } : {}),
            },
          }),
        'code',
      );
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'project.updated',
        entity: 'project',
        entityId: id,
        after: { fields: Object.keys(body).sort() },
      });
      return this.detail(tx, actor, await this.row(tx, id));
    });
  }

  // ----- shared with milestones and assignments ------------------------------------------------

  /** The project if the caller may see it, else "not found" (existence is not revealed). */
  async findVisible(tx: TenantTx, actor: RequestAuth, id: string): Promise<ProjectRow> {
    const visible = await this.access.visibleWhere(tx, actor);
    const row = await tx.project.findFirst({
      where: { AND: [{ id }, visible] },
      select: PROJECT_SELECT,
    });
    if (!row) throw notFound('Project');
    return row;
  }

  async assertManage(actor: RequestAuth, row: ProjectRow): Promise<void> {
    if (!(await this.access.can(actor, 'project.manage', row.leadEmployeeId))) {
      throw forbidden('Not allowed to change this project');
    }
  }

  // ----- helpers -------------------------------------------------------------------------------

  private async row(tx: TenantTx, id: string): Promise<ProjectRow> {
    const row = await tx.project.findUnique({ where: { id }, select: PROJECT_SELECT });
    if (!row) throw notFound('Project');
    return row;
  }

  private async assertEmployee(tx: TenantTx, id: string, path: string): Promise<void> {
    const employee = await tx.employee.findFirst({
      where: { id, status: 'active' },
      select: { id: true },
    });
    if (!employee)
      throw invalid(path, 'unknown_employee', 'This person does not exist or is not active');
  }

  private async assertClient(tx: TenantTx, actor: RequestAuth, id: string): Promise<void> {
    if (!actor.permissions['client.view']) throw forbidden('You cannot choose a client');
    const client = await tx.client.findUnique({ where: { id }, select: { status: true } });
    if (!client) throw invalid('clientId', 'unknown_client', 'This client does not exist');
    if (client.status !== 'active') throw conflict('client', 'This client is archived');
  }

  private async summaries(
    tx: TenantTx,
    actor: RequestAuth,
    rows: readonly ProjectRow[],
  ): Promise<ProjectSummary[]> {
    if (rows.length === 0) return [];
    const today = await workspaceToday(tx, this.context);
    const milestones = await tx.milestone.findMany({
      where: { projectId: { in: rows.map((r) => r.id) } },
      select: { projectId: true, dueDate: true, status: true },
    });
    const leads = [...new Set(rows.flatMap((r) => (r.leadEmployeeId ? [r.leadEmployeeId] : [])))];
    const [manage, staff] = await Promise.all([
      this.access.coveredLeads(actor, 'project.manage', leads),
      this.access.coveredLeads(actor, 'assignment.manage', leads),
    ]);
    const seesClients = Boolean(actor.permissions['client.view']);
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      client: seesClients ? row.client : null,
      status: row.status as ProjectSummary['status'],
      priority: row.priority as ProjectSummary['priority'],
      isBillable: row.isBillable,
      budgetHours: row.budgetHours === null ? null : Number(row.budgetHours),
      startDate: dateOut(row.startDate),
      endDate: row.endDate ? dateOut(row.endDate) : null,
      lead: row.lead,
      health: projectHealth({
        status: row.status as ProjectSummary['status'],
        endDate: row.endDate ? dateOut(row.endDate) : null,
        today,
        milestones: milestones
          .filter((m) => m.projectId === row.id)
          .map((m) => ({ dueDate: dateOut(m.dueDate), status: m.status as 'open' | 'done' })),
      }),
      canEdit: ProjectAccess.covers(manage, row.leadEmployeeId),
      canStaff: ProjectAccess.covers(staff, row.leadEmployeeId),
    }));
  }

  private async detail(tx: TenantTx, actor: RequestAuth, row: ProjectRow): Promise<ProjectDetail> {
    const [summary] = await this.summaries(tx, actor, [row]);
    const today = await workspaceToday(tx, this.context);
    const [milestones, assignments] = await Promise.all([
      tx.milestone.findMany({
        where: { projectId: row.id },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      }),
      tx.projectAssignment.findMany({
        where: { projectId: row.id },
        select: ASSIGNMENT_SELECT,
        orderBy: [{ fromDate: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      ...summary!,
      description: row.description,
      milestones: milestones.map((m) => presentMilestone(m, today)),
      assignments: await presentAssignments(tx, assignments),
    };
  }
}
