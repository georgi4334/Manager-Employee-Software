import { Injectable } from '@nestjs/common';
import type { CreateMilestoneRequest, Milestone, UpdateMilestoneRequest } from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { TenantContext } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { presentMilestone, workspaceToday } from './projects.present.js';
import { dateIn, notFound } from './projects.shared.js';
import { ProjectsService } from './projects.service.js';

/** Milestones follow the rights on their project (`project.manage`). */
@Injectable()
export class MilestonesService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  create(actor: RequestAuth, projectId: string, body: CreateMilestoneRequest): Promise<Milestone> {
    return this.db.tx(async (tx) => {
      const project = await this.projects.findVisible(tx, actor, projectId);
      await this.projects.assertManage(actor, project);
      const row = await tx.milestone.create({
        data: { projectId, title: body.title, dueDate: dateIn(body.dueDate) },
      });
      await this.record(tx, actor, 'created', row.id);
      return presentMilestone(row, await workspaceToday(tx, this.context));
    });
  }

  update(
    actor: RequestAuth,
    projectId: string,
    id: string,
    body: UpdateMilestoneRequest,
  ): Promise<Milestone> {
    return this.db.tx(async (tx) => {
      const project = await this.projects.findVisible(tx, actor, projectId);
      await this.projects.assertManage(actor, project);
      const current = await tx.milestone.findFirst({ where: { id, projectId } });
      if (!current) throw notFound('Milestone');
      const today = await workspaceToday(tx, this.context);
      const row = await tx.milestone.update({
        where: { id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.dueDate !== undefined ? { dueDate: dateIn(body.dueDate) } : {}),
          ...(body.status === 'done' && current.status !== 'done'
            ? { status: 'done', doneOn: dateIn(today) }
            : {}),
          ...(body.status === 'open' ? { status: 'open', doneOn: null } : {}),
        },
      });
      await this.record(tx, actor, 'updated', id, Object.keys(body).sort());
      return presentMilestone(row, today);
    });
  }

  remove(actor: RequestAuth, projectId: string, id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const project = await this.projects.findVisible(tx, actor, projectId);
      await this.projects.assertManage(actor, project);
      const removed = await tx.milestone.deleteMany({ where: { id, projectId } });
      if (removed.count === 0) throw notFound('Milestone');
      await this.record(tx, actor, 'deleted', id);
    });
  }

  private record(
    tx: Parameters<AuditService['record']>[0],
    actor: RequestAuth,
    action: 'created' | 'updated' | 'deleted',
    id: string,
    fields?: string[],
  ) {
    return this.audit.record(tx, {
      actorUserId: actor.userId,
      action: `milestone.${action}`,
      entity: 'milestone',
      entityId: id,
      ...(fields ? { after: { fields } } : {}),
    });
  }
}
