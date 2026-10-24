import { Injectable } from '@nestjs/common';
import type {
  CreateEmployeeRequest,
  DeactivateEmployeeRequest,
  Employee,
  EmployeeList,
  EmployeeQuery,
  InviteEmployeeRequest,
  PermissionCode,
  UpdateEmployeeRequest,
  UpdateOwnEmployeeRequest,
} from '@intime/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import type { TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AssignmentsService } from '../projects/assignments.service.js';
import { InvitationService } from '../auth/invitation.service.js';
import { UserRolesService } from '../roles/user-roles.service.js';
import { OrganizationService } from '../organization/organization.service.js';
import { UsersService } from '../users/users.service.js';

const SELECT = {
  id: true,
  userId: true,
  employeeNo: true,
  firstName: true,
  lastName: true,
  jobTitle: true,
  location: true,
  employmentType: true,
  seniority: true,
  hireDate: true,
  terminationDate: true,
  birthDate: true,
  phone: true,
  country: true,
  status: true,
  erasedAt: true,
  user: { select: { email: true, status: true } },
  department: { select: { id: true, name: true } },
  manager: { select: { id: true, firstName: true, lastName: true } },
  teamMemberships: {
    select: { team: { select: { id: true, name: true } } },
    orderBy: { team: { name: 'asc' as const } },
  },
} satisfies Prisma.EmployeeSelect;

type Row = Prisma.EmployeeGetPayload<{ select: typeof SELECT }>;

const dateOut = (date: Date | null): string | null => date?.toISOString().slice(0, 10) ?? null;
const dateIn = (value: string | null | undefined): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00Z`);
/** Prisma passes "contains" to LIKE unescaped: make % _ and \ plain characters (Postgres' default escape is \). */
const escapeLike = (word: string): string => word.replace(/[\\%_]/g, '\\$&');
const todayUtc = (): string => new Date().toISOString().slice(0, 10);

const notFound = () => new AppException('NOT_FOUND', { message: 'Employee not found' });
const conflict = (field: string, message: string) =>
  new AppException('CONFLICT', { message, params: { field } });
const invalid = (path: string, code: string, message: string) =>
  new AppException('VALIDATION_FAILED', { details: [{ path, code, message }] });

/** Employee records: directory, profiles and onboarding (docs/adr/0006-employees.md). */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly db: TenantDb,
    private readonly authz: AuthorizationService,
    private readonly invitations: InvitationService,
    private readonly userRoles: UserRolesService,
    private readonly users: UsersService,
    private readonly org: OrganizationService,
    private readonly projects: AssignmentsService,
    private readonly audit: AuditService,
  ) {}

  // ----- reading -------------------------------------------------------------------------------

  list(actor: RequestAuth, query: EmployeeQuery): Promise<EmployeeList> {
    if (query.status !== 'active' && !this.seesInactive(actor)) {
      throw new AppException('FORBIDDEN', { message: 'Not allowed to list inactive employees' });
    }
    return this.db.tx(async (tx) => {
      const where: Prisma.EmployeeWhereInput = {
        ...(query.status === 'all' ? {} : { status: query.status }),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        // Every word must match somewhere.
        AND: (query.q?.split(/\s+/).filter(Boolean).map(escapeLike) ?? []).map((word) => ({
          OR: [
            { firstName: { contains: word, mode: 'insensitive' as const } },
            { lastName: { contains: word, mode: 'insensitive' as const } },
            { jobTitle: { contains: word, mode: 'insensitive' as const } },
            { user: { email: { contains: word, mode: 'insensitive' as const } } },
          ],
        })),
      };
      const [rows, total] = await Promise.all([
        tx.employee.findMany({
          where,
          select: SELECT,
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.employee.count({ where }),
      ]);
      // One relation lookup for the whole page instead of one per person.
      const seeFull = await this.authz.allowedEmployees(
        actor,
        'employee.view_profile_full',
        rows.map((row) => row.id),
      );
      const items = [];
      for (const row of rows) items.push(await this.present(actor, row, seeFull.has(row.id)));
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  get(actor: RequestAuth, id: string): Promise<Employee> {
    return this.db.tx(async (tx) => this.present(actor, await this.find(tx, actor, id)));
  }

  me(actor: RequestAuth): Promise<Employee> {
    return this.db.tx(async (tx) => {
      const row = await tx.employee.findFirst({ where: { userId: actor.userId }, select: SELECT });
      if (!row) throw notFound();
      return this.present(actor, row);
    });
  }

  // ----- changing ------------------------------------------------------------------------------

  create(actor: RequestAuth, body: CreateEmployeeRequest): Promise<Employee> {
    return this.db.tx(async (tx) => {
      await this.authz.assert(actor, 'employee.create');
      if (body.email) await this.authz.assert(actor, 'admin.user.invite');
      const { email, ...fields } = body;
      if (fields.employeeNo) await this.assertEmployeeNoFree(tx, fields.employeeNo);

      // The employee first, so a duplicate number fails before any invitation email goes out.
      const created = await this.guardUnique(() =>
        tx.employee.create({ data: this.toData(fields), select: { id: true } }),
      );
      let userId: string | undefined;
      if (email) userId = await this.inviteAccount(tx, actor, created.id, email);

      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'employee.created',
        entity: 'employee',
        entityId: created.id,
        after: { fields: Object.keys(fields).sort(), invited: userId !== undefined },
      });
      return this.present(actor, await this.findRow(tx, created.id));
    });
  }

  update(actor: RequestAuth, id: string, body: UpdateEmployeeRequest): Promise<Employee> {
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, actor, id);
      await this.assertScoped(actor, 'employee.update', row);
      this.assertNotErased(row);

      if (body.employeeNo && body.employeeNo !== row.employeeNo) {
        await this.assertEmployeeNoFree(tx, body.employeeNo, row.id);
      }
      const hire = body.hireDate === undefined ? dateOut(row.hireDate) : body.hireDate;
      const termination = dateOut(row.terminationDate);
      if (hire && termination && termination < hire) {
        throw invalid(
          'hireDate',
          'terminationBeforeHire',
          'Hire date is after the termination date',
        );
      }

      const changed = this.changedFields(row, body);
      if (changed.length === 0) return this.present(actor, row);
      await this.guardUnique(() =>
        tx.employee.update({ where: { id }, data: this.toData(body), select: { id: true } }),
      );
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'employee.updated',
        entity: 'employee',
        entityId: id,
        after: { fields: changed },
      });
      return this.present(actor, await this.findRow(tx, id));
    });
  }

  updateOwn(actor: RequestAuth, body: UpdateOwnEmployeeRequest): Promise<Employee> {
    return this.db.tx(async (tx) => {
      await this.authz.assert(actor, 'employee.update_self_basic', { ownerUserId: actor.userId });
      const row = await tx.employee.findFirst({ where: { userId: actor.userId }, select: SELECT });
      if (!row) throw notFound();
      if (this.changedFields(row, body).length > 0) {
        await tx.employee.update({ where: { id: row.id }, data: { phone: body.phone } });
        await this.audit.record(tx, {
          actorUserId: actor.userId,
          action: 'employee.updated',
          entity: 'employee',
          entityId: row.id,
          after: { fields: ['phone'], self: true },
        });
      }
      return this.present(actor, await this.findRow(tx, row.id));
    });
  }

  /** Invites (or re-sends the invitation to) the person behind an employee record. */
  invite(actor: RequestAuth, id: string, body: InviteEmployeeRequest): Promise<Employee> {
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, actor, id);
      await this.assertScoped(actor, 'employee.update', row);
      if (row.status !== 'active') throw conflict('status', 'The employee is not active');

      let email = body.email;
      if (row.userId) {
        // Open invitation: send it again to the same address (a changed address is not supported yet).
        if (row.user?.status !== 'invited')
          throw conflict('account', 'The account is already set up');
        if (email && email !== row.user.email) {
          throw conflict('email', 'The invitation address cannot be changed');
        }
        email = row.user.email;
      } else if (!email) {
        throw invalid('email', 'required', 'An email address is required');
      }
      await this.inviteAccount(tx, actor, row.id, email);
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'employee.invited',
        entity: 'employee',
        entityId: row.id,
      });
      return this.present(actor, await this.findRow(tx, row.id));
    });
  }

  deactivate(actor: RequestAuth, id: string, body: DeactivateEmployeeRequest): Promise<Employee> {
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, actor, id);
      await this.assertScoped(actor, 'employee.deactivate', row);
      if (row.status === 'inactive') return this.present(actor, row);

      const terminationDate = body.terminationDate ?? todayUtc();
      const hire = dateOut(row.hireDate);
      if (hire && terminationDate < hire) {
        throw invalid(
          'terminationDate',
          'terminationBeforeHire',
          'Termination is before the hire date',
        );
      }
      // Ends the account and its sessions; refuses yourself and the last administrator.
      if (row.userId) await this.users.disableInTx(tx, actor, row.userId);
      await this.org.onEmployeeDeactivated(tx, actor.userId, id);
      await this.projects.onEmployeeDeactivated(tx, id, terminationDate);
      await tx.employee.update({
        where: { id },
        data: { status: 'inactive', terminationDate: dateIn(terminationDate) },
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'employee.deactivated',
        entity: 'employee',
        entityId: id,
        after: { terminationDate },
      });
      return this.present(actor, await this.findRow(tx, id));
    });
  }

  reactivate(actor: RequestAuth, id: string): Promise<Employee> {
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, actor, id);
      await this.assertScoped(actor, 'employee.deactivate', row);
      this.assertNotErased(row);
      if (row.status === 'active') return this.present(actor, row);

      if (row.userId) await this.users.enableInTx(tx, actor, row.userId);
      await tx.employee.update({
        where: { id },
        data: { status: 'active', terminationDate: null },
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'employee.reactivated',
        entity: 'employee',
        entityId: id,
      });
      return this.present(actor, await this.findRow(tx, id));
    });
  }

  // ----- helpers -------------------------------------------------------------------------------

  /** An erased record is a placeholder for statutory data; it never comes back (docs/adr/0011). */
  private assertNotErased(row: Row): void {
    if (row.erasedAt) throw conflict('erased', 'The personal data of this employee was erased');
  }

  private seesInactive(actor: RequestAuth): boolean {
    return actor.permissions['employee.deactivate'] !== undefined;
  }

  /** Row Level Security hides other workspaces; inactive employees are hidden from people who may not manage them. */
  private async find(tx: TenantTx, actor: RequestAuth, id: string): Promise<Row> {
    const row = await tx.employee.findUnique({ where: { id }, select: SELECT });
    if (!row || (row.status === 'inactive' && !this.seesInactive(actor))) throw notFound();
    return row;
  }

  private async findRow(tx: TenantTx, id: string): Promise<Row> {
    return tx.employee.findUniqueOrThrow({ where: { id }, select: SELECT });
  }

  /**
   * Applies the permission's scope to one employee through the reporting tree and departments
   * (docs/adr/0007-organization.md). An employee nobody is related to is reachable only at scope "all".
   */
  private async canScoped(actor: RequestAuth, code: PermissionCode, row: Row): Promise<boolean> {
    return this.authz.can(actor, code, { ownerEmployeeId: row.id });
  }

  private async assertScoped(actor: RequestAuth, code: PermissionCode, row: Row): Promise<void> {
    if (!(await this.canScoped(actor, code, row))) {
      throw new AppException('FORBIDDEN', { message: `Not allowed: ${code}` });
    }
  }

  private async present(actor: RequestAuth, row: Row, seeFull?: boolean): Promise<Employee> {
    const full = seeFull ?? (await this.canScoped(actor, 'employee.view_profile_full', row));
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      jobTitle: row.jobTitle,
      location: row.location,
      email: row.erasedAt ? null : (row.user?.email ?? null),
      status: row.status as Employee['status'],
      department: row.department,
      manager: row.manager,
      teams: row.teamMemberships.map((m) => m.team),
      isSelf: row.userId !== null && row.userId === actor.userId,
      erased: row.erasedAt !== null,
      profile: full
        ? {
            employeeNo: row.employeeNo,
            employmentType: row.employmentType as NonNullable<
              Employee['profile']
            >['employmentType'],
            seniority: row.seniority as NonNullable<Employee['profile']>['seniority'],
            hireDate: dateOut(row.hireDate),
            terminationDate: dateOut(row.terminationDate),
            birthDate: dateOut(row.birthDate),
            phone: row.phone,
            country: row.country,
            accountStatus: (row.user?.status ?? null) as NonNullable<
              Employee['profile']
            >['accountStatus'],
          }
        : null,
    };
  }

  private toData(
    fields: Partial<Omit<CreateEmployeeRequest, 'email'>>,
  ): Prisma.EmployeeUncheckedCreateInput {
    const { hireDate, birthDate, ...rest } = fields;
    return {
      ...rest,
      hireDate: dateIn(hireDate),
      birthDate: dateIn(birthDate),
    } as Prisma.EmployeeUncheckedCreateInput;
  }

  /** Names of the fields a request would actually change (values never go to the audit log). */
  private changedFields(row: Row, body: Partial<UpdateEmployeeRequest>): string[] {
    const current: Record<string, unknown> = {
      ...row,
      hireDate: dateOut(row.hireDate),
      birthDate: dateOut(row.birthDate),
    };
    return Object.entries(body)
      .filter(([key, value]) => value !== undefined && current[key] !== value)
      .map(([key]) => key)
      .sort();
  }

  private async assertEmployeeNoFree(tx: TenantTx, employeeNo: string, exceptId?: string) {
    const taken = await tx.employee.findFirst({
      where: { employeeNo, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (taken) throw conflict('employeeNo', 'Employee number is taken');
  }

  /** Two requests racing past the pre-check still end as a clean CONFLICT instead of a 500. */
  private async guardUnique<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('employeeNo', 'Employee number is taken');
      }
      throw error;
    }
  }

  /**
   * Creates (or re-sends) the account invitation and links it to the employee. HR may invite plain Employees;
   * touching an invitation that carries other roles needs the right to assign roles, so HR cannot downgrade
   * an invited administrator by re-inviting their address.
   */
  private async inviteAccount(
    tx: TenantTx,
    actor: RequestAuth,
    employeeId: string,
    rawEmail: string,
  ): Promise<string> {
    const employeeRoleId = await this.userRoles.roleIdByKey(tx, 'employee');
    const existing = await tx.user.findFirst({
      where: { email: rawEmail.trim().toLowerCase() },
      select: {
        id: true,
        status: true,
        roles: { select: { roleId: true } },
        employee: { select: { id: true } },
      },
    });
    if (existing) {
      if (existing.employee && existing.employee.id !== employeeId) {
        throw conflict('email', 'This address already belongs to another employee');
      }
      const onlyEmployee = existing.roles.every((r) => r.roleId === employeeRoleId);
      if (existing.status === 'invited' && !onlyEmployee) {
        await this.authz.assert(actor, 'admin.role.assign');
      }
    }
    const roleIds =
      existing && existing.roles.length > 0
        ? existing.roles.map((r) => r.roleId)
        : [employeeRoleId];
    const { userId } = await this.invitations.invite(tx, rawEmail, roleIds);
    await tx.employee.update({ where: { id: employeeId }, data: { userId } });
    return userId;
  }
}
