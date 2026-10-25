import { Injectable } from '@nestjs/common';
import { taskKey, type LeaveConflicts } from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { ProjectAccess } from '../projects/project-access.service.js';
import { dateOut, notFound } from './leave.shared.js';

/** What a leave request collides with: projects, milestones and tasks (docs/adr/0017-integrations.md). */
@Injectable()
export class LeaveConflictsService {
  constructor(
    private readonly db: TenantDb,
    private readonly authz: AuthorizationService,
    private readonly access: ProjectAccess,
  ) {}

  conflicts(actor: RequestAuth, requestId: string): Promise<LeaveConflicts> {
    return this.db.tx(async (tx) => {
      const request = await tx.leaveRequest.findUnique({
        where: { id: requestId },
        select: { employeeId: true, startDate: true, endDate: true },
      });
      if (
        !request ||
        !(await this.authz.can(actor, 'leave.approve', { ownerEmployeeId: request.employeeId }))
      ) {
        throw notFound('Leave request');
      }
      const { employeeId, startDate, endDate } = request;
      // Everything is limited to what the caller may see through the project and task permissions anyway.
      const projectScope = await this.access.visibleWhere(tx, actor, 'project.view');
      const taskScope = await this.access.visibleWhere(tx, actor, 'task.view');

      const assignments = await tx.projectAssignment.findMany({
        where: {
          employeeId,
          fromDate: { lte: endDate },
          OR: [{ toDate: null }, { toDate: { gte: startDate } }],
          project: { AND: [projectScope, { status: { not: 'done' } }] },
        },
        select: {
          allocationPct: true,
          fromDate: true,
          toDate: true,
          project: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ project: { code: 'asc' } }, { fromDate: 'asc' }],
      });
      const projectIds = [...new Set(assignments.map((a) => a.project.id))];

      const milestones = await tx.milestone.findMany({
        where: {
          projectId: { in: projectIds },
          status: { not: 'done' },
          dueDate: { gte: startDate, lte: endDate },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          project: { select: { id: true, code: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      });
      const tasks = await tx.task.findMany({
        where: {
          assigneeEmployeeId: employeeId,
          status: { not: 'done' },
          dueDate: { gte: startDate, lte: endDate },
          project: taskScope,
        },
        select: {
          id: true,
          number: true,
          dueDate: true,
          project: { select: { id: true, code: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      });

      return {
        assignments: assignments.map((a) => ({
          projectId: a.project.id,
          code: a.project.code,
          name: a.project.name,
          allocationPct: a.allocationPct,
          fromDate: dateOut(a.fromDate),
          toDate: a.toDate ? dateOut(a.toDate) : null,
        })),
        milestones: milestones.map((m) => ({
          id: m.id,
          projectId: m.project.id,
          code: m.project.code,
          title: m.title,
          dueDate: dateOut(m.dueDate),
        })),
        tasks: tasks.map((t) => ({
          id: t.id,
          projectId: t.project.id,
          key: taskKey(t.project.code, t.number),
          dueDate: dateOut(t.dueDate!),
        })),
      };
    });
  }
}
