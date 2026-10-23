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
}

export const ORG_RELATIONS = Symbol('ORG_RELATIONS');

/**
 * Until the Organization module exists nobody has reports, teams or departments, so only "self" and
 * "other" are known. Grants with scope reports/team/department therefore never reach beyond the actor:
 * fail closed. The Organization module replaces this provider.
 */
export class SelfOnlyOrgRelations implements OrgRelations {
  async relationOf(actorUserId: string, ownerUserId: string): Promise<Relation> {
    return actorUserId === ownerUserId ? 'self' : 'other';
  }
}

export interface Actor {
  userId: string;
  permissions: GrantedPermissions;
}

export interface Resource {
  /** The user the record belongs to. Omit for checks that are not about one person's record. */
  ownerUserId?: string;
}

@Injectable()
export class AuthorizationService {
  constructor(@Inject(ORG_RELATIONS) private readonly org: OrgRelations) {}

  /** May the actor use this permission on this record? Without a resource: do they hold it at all? */
  async can(actor: Actor, permission: PermissionCode, resource: Resource = {}): Promise<boolean> {
    const scope = actor.permissions[permission];
    if (!scope) return false;
    if (scope === 'all' || resource.ownerUserId === undefined) return true;
    const relation = await this.org.relationOf(actor.userId, resource.ownerUserId);
    return scopeCovers(scope, relation);
  }

  /** Throws FORBIDDEN unless can(...). Services call this with the loaded record before acting on it. */
  async assert(actor: Actor, permission: PermissionCode, resource: Resource = {}): Promise<void> {
    if (!(await this.can(actor, permission, resource))) {
      throw new AppException('FORBIDDEN', { message: `Not allowed: ${permission}` });
    }
  }
}
