import { Inject, Injectable } from '@nestjs/common';
import {
  scopeCovers,
  type GrantedPermissions,
  type PermissionCode,
  type Relation,
} from '@intime/contracts';
import { AppException } from '../errors/app-exception.js';

/** Answers how the owner of a record relates to the person asking (self, report, same department, ...). */
export interface OrgRelations {
  relationOf(actorUserId: string, ownerUserId: string): Promise<Relation>;
  /**
   * The relation of the actor to several employees at once (one query). Employees the actor cannot be related
   * to, including unknown ids, map to "other": the answer is always fail-closed.
   */
  relationsToEmployees(
    actorUserId: string,
    employeeIds: readonly string[],
  ): Promise<Map<string, Relation>>;
}

export const ORG_RELATIONS = Symbol('ORG_RELATIONS');

export interface Actor {
  userId: string;
  permissions: GrantedPermissions;
}

export interface Resource {
  /** The user the record belongs to. Omit for checks that are not about one person's record. */
  ownerUserId?: string;
  /** The employee the record belongs to (people without an account have no user). Wins over ownerUserId. */
  ownerEmployeeId?: string;
}

@Injectable()
export class AuthorizationService {
  constructor(@Inject(ORG_RELATIONS) private readonly org: OrgRelations) {}

  /** May the actor use this permission on this record? Without a resource: do they hold it at all? */
  async can(actor: Actor, permission: PermissionCode, resource: Resource = {}): Promise<boolean> {
    const scope = actor.permissions[permission];
    if (!scope) return false;
    if (scope === 'all') return true;
    if (resource.ownerEmployeeId !== undefined) {
      const relations = await this.org.relationsToEmployees(actor.userId, [
        resource.ownerEmployeeId,
      ]);
      return scopeCovers(scope, relations.get(resource.ownerEmployeeId) ?? 'other');
    }
    if (resource.ownerUserId === undefined) return true;
    const relation = await this.org.relationOf(actor.userId, resource.ownerUserId);
    return scopeCovers(scope, relation);
  }

  /**
   * Like can(), for many employees of one permission: one relation lookup for the whole list. Returns the
   * ids the actor may use the permission on.
   */
  async allowedEmployees(
    actor: Actor,
    permission: PermissionCode,
    employeeIds: readonly string[],
  ): Promise<Set<string>> {
    const scope = actor.permissions[permission];
    if (!scope) return new Set();
    if (scope === 'all') return new Set(employeeIds);
    const relations = await this.org.relationsToEmployees(actor.userId, employeeIds);
    return new Set(employeeIds.filter((id) => scopeCovers(scope, relations.get(id) ?? 'other')));
  }

  /** Throws FORBIDDEN unless can(...). Services call this with the loaded record before acting on it. */
  async assert(actor: Actor, permission: PermissionCode, resource: Resource = {}): Promise<void> {
    if (!(await this.can(actor, permission, resource))) {
      throw new AppException('FORBIDDEN', { message: `Not allowed: ${permission}` });
    }
  }
}
