import { Injectable } from '@nestjs/common';
import {
  endedAt,
  type Assignment,
  type CreateAssignmentRequest,
  type UpdateAssignmentRequest,
} from '@intime/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import type { TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import { ProjectAccess } from './project-access.service.js';
import { ASSIGNMENT_SELECT, presentAssignments } from './projects.present.js';
import { conflict, dateIn, dateOut, forbidden, invalid, notFound } from './projects.shared.js';
import { ProjectsService } from './projects.service.js';

/** Staffing of projects (docs/adr/0013-clients-and-projects.md): allocation is a plan, over-allocation a warning. */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly db: TenantDb,
    private readonly projects: ProjectsService,
    private readonly access: ProjectAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  create(
    actor: RequestAuth,
    projectId: string,
    body: CreateAssignmentRequest,
  ): Promise<Assignment> {
    return this.db.tx(async (tx) => {
      const project = await this.projects.findVisible(tx, actor, projectId);
      await this.assertStaff(actor, project.leadEmployeeId);
      const employee = await tx.employee.findFirst({
        where: { id: body.employeeId, status: 'active' },
        select: { id: true, userId: true },
      });
      if (!employee) {
        throw invalid(
          'employeeId',
          'unknown_employee',
          'This person does not exist or is not active',
        );
      }
      await this.assertNoOverlap(tx, projectId, employee.id, body.fromDate, body.toDate ?? null);
      const row = await this.guardOverlap(() =>
        tx.projectAssignment.create({
          data: {
            projectId,
            employeeId: employee.id,
            role: body.role ?? null,
            allocationPct: body.allocationPct,
            fromDate: dateIn(body.fromDate),
            toDate: body.toDate ? dateIn(body.toDate) : null,
          },
          select: ASSIGNMENT_SELECT,
        }),
      );
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'assignment.created',
        entity: 'project_assignment',
        entityId: row.id,
        after: { projectId, employeeId: employee.id },
      });
      if (employee.userId && employee.userId !== actor.userId) {
        await this.outbox.publish(tx, 'project.assigned', {
          recipientUserId: employee.userId,
          projectId,
          projectName: project.name,
        });
      }
      return (await presentAssignments(tx, [row]))[0]!;
    });
  }

  update(
    actor: RequestAuth,
    projectId: string,
    id: string,
    body: UpdateAssignmentRequest,
  ): Promise<Assignment> {
    return this.db.tx(async (tx) => {
      const project = await this.projects.findVisible(tx, actor, projectId);
      await this.assertStaff(actor, project.leadEmployeeId);
      const current = await tx.projectAssignment.findFirst({ where: { id, projectId } });
      if (!current) throw notFound('Assignment');

      const fromDate = body.fromDate ?? dateOut(current.fromDate);
      const toDate =
        body.toDate === undefined ? (current.toDate ? dateOut(current.toDate) : null) : body.toDate;
      if (toDate && toDate < fromDate) {
        throw invalid('toDate', 'end_before_start', 'The end cannot be before the start');
      }
      await this.assertNoOverlap(tx, projectId, current.employeeId, fromDate, toDate, id);
      const row = await this.guardOverlap(() =>
        tx.projectAssignment.update({
          where: { id },
          data: {
            ...(body.role !== undefined ? { role: body.role } : {}),
            ...(body.allocationPct !== undefined ? { allocationPct: body.allocationPct } : {}),
            fromDate: dateIn(fromDate),
            toDate: toDate ? dateIn(toDate) : null,
          },
          select: ASSIGNMENT_SELECT,
        }),
      );
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'assignment.updated',
        entity: 'project_assignment',
        entityId: id,
        after: { fields: Object.keys(body).sort() },
      });
      return (await presentAssignments(tx, [row]))[0]!;
    });
  }

  remove(actor: RequestAuth, projectId: string, id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const project = await this.projects.findVisible(tx, actor, projectId);
      await this.assertStaff(actor, project.leadEmployeeId);
      const removed = await tx.projectAssignment.deleteMany({ where: { id, projectId } });
      if (removed.count === 0) throw notFound('Assignment');
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'assignment.deleted',
        entity: 'project_assignment',
        entityId: id,
        after: { projectId },
      });
    });
  }

  /**
   * Called when an employee is deactivated, in the same transaction: assignments that would start later disappear,
   * running ones end on the termination date, and projects they lead are left without a lead.
   */
  async onEmployeeDeactivated(
    tx: TenantTx,
    employeeId: string,
    terminationDate: string,
  ): Promise<void> {
    await tx.project.updateMany({
      where: { leadEmployeeId: employeeId },
      data: { leadEmployeeId: null },
    });
    await tx.projectAssignment.deleteMany({
      where: { employeeId, fromDate: { gt: dateIn(terminationDate) } },
    });
    const running = await tx.projectAssignment.findMany({
      where: { employeeId },
      select: { id: true, toDate: true },
    });
    for (const assignment of running) {
      const to = assignment.toDate ? dateOut(assignment.toDate) : null;
      if (to !== null && to <= terminationDate) continue;
      await tx.projectAssignment.update({
        where: { id: assignment.id },
        data: { toDate: dateIn(endedAt(to, terminationDate)) },
      });
    }
  }

  // ----- helpers -------------------------------------------------------------------------------

  private async assertStaff(actor: RequestAuth, leadEmployeeId: string | null): Promise<void> {
    if (!(await this.access.can(actor, 'assignment.manage', leadEmployeeId))) {
      throw forbidden('Not allowed to staff this project');
    }
  }

  private async assertNoOverlap(
    tx: TenantTx,
    projectId: string,
    employeeId: string,
    fromDate: string,
    toDate: string | null,
    exceptId?: string,
  ): Promise<void> {
    const clash = await tx.projectAssignment.findFirst({
      where: {
        projectId,
        employeeId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
        fromDate: toDate ? { lte: dateIn(toDate) } : {},
        OR: [{ toDate: null }, { toDate: { gte: dateIn(fromDate) } }],
      },
      select: { id: true },
    });
    if (clash)
      throw conflict('overlap', 'This person is already staffed on the project in this period');
  }

  /** Two simultaneous requests: the database refuses the second, as the same conflict. */
  private async guardOverlap<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (String((error as Error)?.message ?? '').includes('project_assignment_no_overlap')) {
        throw conflict('overlap', 'This person is already staffed on the project in this period');
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2004') {
        throw conflict('overlap', 'This person is already staffed on the project in this period');
      }
      throw error;
    }
  }
}
