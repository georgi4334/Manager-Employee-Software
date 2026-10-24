import { Injectable } from '@nestjs/common';
import type {
  AssignmentRequest,
  CreateDepartmentRequest,
  CreateTeamRequest,
  Department,
  OrgChart,
  PermissionCode,
  SetTeamMembersRequest,
  Team,
  UpdateDepartmentRequest,
  UpdateTeamRequest,
} from '@intime/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AppException } from '../../common/errors/app-exception.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;

const notFound = (what: string) => new AppException('NOT_FOUND', { message: `${what} not found` });
const conflict = (field: string, message: string) =>
  new AppException('CONFLICT', { message, params: { field } });
const invalid = (path: string, code: string, message: string) =>
  new AppException('VALIDATION_FAILED', { details: [{ path, code, message }] });
const cycle = (message: string) => new AppException('ORG_CYCLE', { message });

/** Departments, teams and reporting lines (docs/adr/0007-organization.md). */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly audit: AuditService,
  ) {}

  // ----- reading -------------------------------------------------------------------------------

  chart(actor: RequestAuth): Promise<OrgChart> {
    this.requireWorkspaceWide(actor, 'org.view');
    return this.db.tx(async (tx) => {
      const nodes = await tx.employee.findMany({
        where: { status: 'active' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
          managerId: true,
          departmentId: true,
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        take: 2000,
      });
      return { nodes };
    });
  }

  listDepartments(actor: RequestAuth): Promise<Department[]> {
    this.requireWorkspaceWide(actor, 'org.view');
    return this.db.tx(async (tx) => {
      const rows = await tx.department.findMany({
        select: {
          id: true,
          name: true,
          parentId: true,
          head: PERSON,
          _count: { select: { employees: { where: { status: 'active' } }, teams: true } },
        },
        orderBy: { name: 'asc' },
      });
      return rows.map(({ _count, ...row }) => ({
        ...row,
        employeeCount: _count.employees,
        teamCount: _count.teams,
      }));
    });
  }

  listTeams(actor: RequestAuth): Promise<Team[]> {
    this.requireWorkspaceWide(actor, 'org.view');
    return this.db.tx((tx) => this.teams(tx));
  }

  // ----- departments ---------------------------------------------------------------------------

  createDepartment(actor: RequestAuth, body: CreateDepartmentRequest): Promise<Department> {
    this.requireWorkspaceWide(actor, 'org.manage');
    return this.db.tx(async (tx) => {
      await this.lock(tx);
      await this.assertDepartmentNameFree(tx, body.name);
      if (body.parentId) await this.assertDepartmentExists(tx, body.parentId, 'parentId');
      if (body.headEmployeeId)
        await this.assertActiveEmployee(tx, body.headEmployeeId, 'headEmployeeId');
      const created = await this.guardUnique(() =>
        tx.department.create({
          data: {
            name: body.name,
            parentId: body.parentId ?? null,
            headEmployeeId: body.headEmployeeId ?? null,
          },
          select: { id: true },
        }),
      );
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'org.department_created',
        entity: 'department',
        entityId: created.id,
        after: {
          name: body.name,
          parentId: body.parentId ?? null,
          headEmployeeId: body.headEmployeeId ?? null,
        },
      });
      return this.department(tx, created.id);
    });
  }

  updateDepartment(
    actor: RequestAuth,
    id: string,
    body: UpdateDepartmentRequest,
  ): Promise<Department> {
    this.requireWorkspaceWide(actor, 'org.manage');
    return this.db.tx(async (tx) => {
      await this.lock(tx);
      const current = await tx.department.findUnique({ where: { id } });
      if (!current) throw notFound('Department');
      if (body.name !== undefined && body.name.toLowerCase() !== current.name.toLowerCase()) {
        await this.assertDepartmentNameFree(tx, body.name, id);
      }
      if (body.parentId) {
        await this.assertDepartmentExists(tx, body.parentId, 'parentId');
        if (body.parentId === id || (await this.departmentIsAncestor(tx, id, body.parentId))) {
          throw cycle('A department cannot be placed below itself or one of its sub-departments');
        }
      }
      if (body.headEmployeeId)
        await this.assertActiveEmployee(tx, body.headEmployeeId, 'headEmployeeId');
      await this.guardUnique(() => tx.department.update({ where: { id }, data: body }));
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'org.department_updated',
        entity: 'department',
        entityId: id,
        before: {
          name: current.name,
          parentId: current.parentId,
          headEmployeeId: current.headEmployeeId,
        },
        after: body as Prisma.InputJsonObject,
      });
      return this.department(tx, id);
    });
  }

  deleteDepartment(actor: RequestAuth, id: string): Promise<void> {
    this.requireWorkspaceWide(actor, 'org.manage');
    return this.db.tx(async (tx) => {
      await this.lock(tx);
      const current = await tx.department.findUnique({
        where: { id },
        select: {
          name: true,
          _count: { select: { employees: true, children: true, teams: true } },
        },
      });
      if (!current) throw notFound('Department');
      if (current._count.employees + current._count.children + current._count.teams > 0) {
        throw conflict('in_use', 'The department still has employees, sub-departments or teams');
      }
      await tx.department.delete({ where: { id } });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'org.department_deleted',
        entity: 'department',
        entityId: id,
        before: { name: current.name },
      });
    });
  }

  // ----- teams ---------------------------------------------------------------------------------

  createTeam(actor: RequestAuth, body: CreateTeamRequest): Promise<Team> {
    this.requireWorkspaceWide(actor, 'org.manage');
    return this.db.tx(async (tx) => {
      await this.lock(tx);
      await this.assertDepartmentExists(tx, body.departmentId, 'departmentId');
      await this.assertTeamNameFree(tx, body.departmentId, body.name);
      if (body.leadEmployeeId)
        await this.assertActiveEmployee(tx, body.leadEmployeeId, 'leadEmployeeId');
      const created = await this.guardUnique(() =>
        tx.team.create({
          data: {
            name: body.name,
            departmentId: body.departmentId,
            leadEmployeeId: body.leadEmployeeId ?? null,
          },
          select: { id: true },
        }),
      );
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'org.team_created',
        entity: 'team',
        entityId: created.id,
        after: {
          name: body.name,
          departmentId: body.departmentId,
          leadEmployeeId: body.leadEmployeeId ?? null,
        },
      });
      return this.team(tx, created.id);
    });
  }

  updateTeam(actor: RequestAuth, id: string, body: UpdateTeamRequest): Promise<Team> {
    this.requireWorkspaceWide(actor, 'org.manage');
    return this.db.tx(async (tx) => {
      await this.lock(tx);
      const current = await tx.team.findUnique({ where: { id } });
      if (!current) throw notFound('Team');
      if (body.departmentId)
        await this.assertDepartmentExists(tx, body.departmentId, 'departmentId');
      const departmentId = body.departmentId ?? current.departmentId;
      const name = body.name ?? current.name;
      if (
        body.departmentId !== undefined ||
        (body.name !== undefined && body.name.toLowerCase() !== current.name.toLowerCase())
      ) {
        await this.assertTeamNameFree(tx, departmentId, name, id);
      }
      if (body.leadEmployeeId)
        await this.assertActiveEmployee(tx, body.leadEmployeeId, 'leadEmployeeId');
      await this.guardUnique(() => tx.team.update({ where: { id }, data: body }));
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'org.team_updated',
        entity: 'team',
        entityId: id,
        before: {
          name: current.name,
          departmentId: current.departmentId,
          leadEmployeeId: current.leadEmployeeId,
        },
        after: body as Prisma.InputJsonObject,
      });
      return this.team(tx, id);
    });
  }

  deleteTeam(actor: RequestAuth, id: string): Promise<void> {
    this.requireWorkspaceWide(actor, 'org.manage');
    return this.db.tx(async (tx) => {
      await this.lock(tx);
      const current = await tx.team.findUnique({ where: { id }, select: { name: true } });
      if (!current) throw notFound('Team');
      await tx.team.delete({ where: { id } });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'org.team_deleted',
        entity: 'team',
        entityId: id,
        before: { name: current.name },
      });
    });
  }

  setTeamMembers(actor: RequestAuth, id: string, body: SetTeamMembersRequest): Promise<Team> {
    this.requireWorkspaceWide(actor, 'org.manage');
    return this.db.tx(async (tx) => {
      await this.lock(tx);
      if (!(await tx.team.findUnique({ where: { id }, select: { id: true } })))
        throw notFound('Team');
      const wanted = body.employeeIds;
      const active = await tx.employee.findMany({
        where: { id: { in: wanted }, status: 'active' },
        select: { id: true },
      });
      if (active.length !== wanted.length) {
        throw invalid(
          'employeeIds',
          'unknown_or_inactive',
          'Every member must be an active employee',
        );
      }
      const existing = (
        await tx.teamMember.findMany({ where: { teamId: id }, select: { employeeId: true } })
      ).map((m) => m.employeeId);
      const added = wanted.filter((employeeId) => !existing.includes(employeeId));
      const removed = existing.filter((employeeId) => !wanted.includes(employeeId));
      if (removed.length > 0) {
        await tx.teamMember.deleteMany({ where: { teamId: id, employeeId: { in: removed } } });
      }
      if (added.length > 0) {
        await tx.teamMember.createMany({
          data: added.map((employeeId) => ({ teamId: id, employeeId })),
        });
      }
      if (added.length + removed.length > 0) {
        await this.audit.record(tx, {
          actorUserId: actor.userId,
          action: 'org.team_members_changed',
          entity: 'team',
          entityId: id,
          after: { added, removed },
        });
      }
      return this.team(tx, id);
    });
  }

  // ----- reporting lines and department of one employee ----------------------------------------

  assign(actor: RequestAuth, employeeId: string, body: AssignmentRequest): Promise<void> {
    this.requireWorkspaceWide(actor, 'org.manage');
    return this.db.tx(async (tx) => {
      await this.lock(tx);
      const employee = await tx.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, status: true, managerId: true, departmentId: true },
      });
      if (!employee) throw notFound('Employee');
      if (employee.status !== 'active') throw conflict('status', 'The employee is not active');

      if (body.managerId) {
        if (body.managerId === employeeId) throw cycle('An employee cannot be their own manager');
        await this.assertActiveEmployee(tx, body.managerId, 'managerId');
        if (await this.isAncestor(tx, employeeId, body.managerId)) {
          throw cycle('The new manager reports, directly or indirectly, to this employee');
        }
      }
      if (body.departmentId)
        await this.assertDepartmentExists(tx, body.departmentId, 'departmentId');

      if (employee.managerId === body.managerId && employee.departmentId === body.departmentId)
        return;
      await tx.employee.update({
        where: { id: employeeId },
        data: { managerId: body.managerId, departmentId: body.departmentId },
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'org.employee_assigned',
        entity: 'employee',
        entityId: employeeId,
        before: { managerId: employee.managerId, departmentId: employee.departmentId },
        after: { managerId: body.managerId, departmentId: body.departmentId },
      });
    });
  }

  // ----- hooks of the employee lifecycle (called inside their transaction) ---------------------

  /**
   * Keeps the tree whole when somebody leaves: direct reports move up to the leaver's own manager, and the
   * leaver stops being a department head, team lead or team member.
   */
  async onEmployeeDeactivated(
    tx: TenantTx,
    actorUserId: string,
    employeeId: string,
  ): Promise<void> {
    await this.lock(tx);
    const leaver = await tx.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { managerId: true },
    });
    const reports = await tx.employee.findMany({
      where: { managerId: employeeId },
      select: { id: true },
    });
    if (reports.length > 0) {
      await tx.employee.updateMany({
        where: { managerId: employeeId },
        data: { managerId: leaver.managerId },
      });
    }
    const headed = await tx.department.updateMany({
      where: { headEmployeeId: employeeId },
      data: { headEmployeeId: null },
    });
    const led = await tx.team.updateMany({
      where: { leadEmployeeId: employeeId },
      data: { leadEmployeeId: null },
    });
    const memberships = await tx.teamMember.deleteMany({ where: { employeeId } });
    if (reports.length + headed.count + led.count + memberships.count > 0) {
      await this.audit.record(tx, {
        actorUserId,
        action: 'org.employee_offboarded',
        entity: 'employee',
        entityId: employeeId,
        after: {
          reportIds: reports.map((r) => r.id),
          newManagerId: leaver.managerId,
          departmentsUnheaded: headed.count,
          teamsUnled: led.count,
          teamsLeft: memberships.count,
        },
      });
    }
  }

  /** A returning employee keeps the department, but not a manager who has left in the meantime. */
  async onEmployeeReactivated(tx: TenantTx, employeeId: string): Promise<void> {
    await this.lock(tx);
    const row = await tx.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { manager: { select: { status: true } }, managerId: true },
    });
    if (row.managerId && row.manager?.status !== 'active') {
      await tx.employee.update({ where: { id: employeeId }, data: { managerId: null } });
    }
  }

  // ----- helpers -------------------------------------------------------------------------------

  /** Structure is visible and editable workspace-wide or not at all: there is no "partial" organization. */
  private requireWorkspaceWide(actor: RequestAuth, code: PermissionCode): void {
    if (actor.permissions[code] !== 'all') {
      throw new AppException('FORBIDDEN', { message: `Not allowed: ${code}` });
    }
  }

  /** One writer at a time per workspace: two concurrent moves cannot combine into a cycle. */
  private async lock(tx: TenantTx): Promise<void> {
    const tenantId = this.context.requireTenantId();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`organization:${tenantId}`}))`;
  }

  /** Is `candidate` somewhere above `employeeId` in the manager chain? (Starting at `candidate` itself.) */
  private async isAncestor(tx: TenantTx, employeeId: string, candidate: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ found: number }[]>`
      WITH RECURSIVE up(id) AS (
        SELECT manager_id FROM employee WHERE id = ${candidate}::uuid
        UNION
        SELECT e.manager_id FROM employee e JOIN up ON e.id = up.id WHERE e.manager_id IS NOT NULL
      )
      SELECT 1 AS found FROM up WHERE id = ${employeeId}::uuid LIMIT 1`;
    return rows.length > 0;
  }

  /** Would `parentCandidate` end up below `departmentId`? (It does if the department is above it.) */
  private async departmentIsAncestor(
    tx: TenantTx,
    departmentId: string,
    parentCandidate: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ found: number }[]>`
      WITH RECURSIVE up(id) AS (
        SELECT parent_id FROM department WHERE id = ${parentCandidate}::uuid
        UNION
        SELECT d.parent_id FROM department d JOIN up ON d.id = up.id WHERE d.parent_id IS NOT NULL
      )
      SELECT 1 AS found FROM up WHERE id = ${departmentId}::uuid LIMIT 1`;
    return rows.length > 0;
  }

  private async assertActiveEmployee(tx: TenantTx, id: string, path: string): Promise<void> {
    const row = await tx.employee.findUnique({ where: { id }, select: { status: true } });
    if (row?.status !== 'active') {
      throw invalid(path, 'unknown_or_inactive', 'Must be an active employee of this workspace');
    }
  }

  private async assertDepartmentExists(tx: TenantTx, id: string, path: string): Promise<void> {
    if (!(await tx.department.findUnique({ where: { id }, select: { id: true } }))) {
      throw invalid(path, 'unknown', 'Unknown department');
    }
  }

  private async assertDepartmentNameFree(
    tx: TenantTx,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const taken = await tx.department.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (taken) throw conflict('name', 'A department with this name exists');
  }

  private async assertTeamNameFree(
    tx: TenantTx,
    departmentId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const taken = await tx.team.findFirst({
      where: {
        departmentId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (taken) throw conflict('name', 'A team with this name exists in the department');
  }

  /** Two requests racing past a pre-check still end as a clean CONFLICT. */
  private async guardUnique<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('name', 'The name is taken');
      }
      throw error;
    }
  }

  private async department(tx: TenantTx, id: string): Promise<Department> {
    const row = await tx.department.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        parentId: true,
        head: PERSON,
        _count: { select: { employees: { where: { status: 'active' } }, teams: true } },
      },
    });
    const { _count, ...rest } = row;
    return { ...rest, employeeCount: _count.employees, teamCount: _count.teams };
  }

  private async team(tx: TenantTx, id: string): Promise<Team> {
    const [team] = await this.teams(tx, id);
    if (!team) throw notFound('Team');
    return team;
  }

  private async teams(tx: TenantTx, id?: string): Promise<Team[]> {
    const rows = await tx.team.findMany({
      where: id ? { id } : {},
      select: {
        id: true,
        name: true,
        department: { select: { id: true, name: true } },
        lead: PERSON,
        members: {
          select: { employee: PERSON },
          orderBy: [{ employee: { lastName: 'asc' } }, { employee: { firstName: 'asc' } }],
        },
      },
      orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
    });
    return rows.map(({ members, ...row }) => ({ ...row, members: members.map((m) => m.employee) }));
  }
}
