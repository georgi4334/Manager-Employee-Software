import { Injectable } from '@nestjs/common';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TenantTx } from '../../infrastructure/tenancy/tenant-context.js';

type ProjectPermission = 'project.manage' | 'assignment.manage';

/** Who may see and change which projects (docs/adr/0013-clients-and-projects.md §4). The scope is about people. */
@Injectable()
export class ProjectAccess {
  constructor(private readonly authz: AuthorizationService) {}

  async ownEmployeeId(tx: TenantTx, actor: RequestAuth): Promise<string | null> {
    const employee = await tx.employee.findFirst({
      where: { userId: actor.userId, status: 'active' },
      select: { id: true },
    });
    return employee?.id ?? null;
  }

  /**
   * The projects the caller may see: all at scope "all", otherwise the ones led by or staffing somebody inside
   * the scope ("own" = themselves).
   */
  async visibleWhere(
    tx: TenantTx,
    actor: RequestAuth,
    code: 'project.view' | 'task.view' = 'project.view',
  ): Promise<Prisma.ProjectWhereInput> {
    const scope = actor.permissions[code];
    if (!scope) return { id: { in: [] } };
    if (scope === 'all') return {};
    const everyone = (await tx.employee.findMany({ select: { id: true } })).map((e) => e.id);
    const allowed = [...(await this.authz.allowedEmployees(actor, code, everyone))];
    if (allowed.length === 0) return { id: { in: [] } };
    return {
      OR: [
        { leadEmployeeId: { in: allowed } },
        { assignments: { some: { employeeId: { in: allowed } } } },
      ],
    };
  }

  /** The ids among `ids` that the caller reaches with this permission's scope. */
  allowed(actor: RequestAuth, code: 'task.view' | 'project.view', ids: readonly string[]) {
    return this.authz.allowedEmployees(actor, code, ids);
  }

  /** May the caller use this permission on a project with this lead? Scope "all" needs no lead. */
  async can(
    actor: RequestAuth,
    code: ProjectPermission,
    leadEmployeeId: string | null,
  ): Promise<boolean> {
    const scope = actor.permissions[code];
    if (!scope) return false;
    if (scope === 'all') return true;
    return leadEmployeeId
      ? this.authz.can(actor, code, { ownerEmployeeId: leadEmployeeId })
      : false;
  }

  /** The same for many projects at once: the ids of the leads the caller covers (or null = everything). */
  async coveredLeads(
    actor: RequestAuth,
    code: ProjectPermission,
    leadIds: readonly string[],
  ): Promise<Set<string> | null> {
    const scope = actor.permissions[code];
    if (!scope) return new Set();
    if (scope === 'all') return null;
    return this.authz.allowedEmployees(actor, code, leadIds);
  }

  /** `canX` flag of one project given the result of coveredLeads. */
  static covers(covered: Set<string> | null, leadEmployeeId: string | null): boolean {
    return covered === null || (leadEmployeeId !== null && covered.has(leadEmployeeId));
  }
}
