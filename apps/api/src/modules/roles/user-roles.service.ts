import { Injectable } from '@nestjs/common';
import {
  escalations,
  isValidGrant,
  type PermissionScope,
  type SystemRole,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AppException } from '../../common/errors/app-exception.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';

/** The permission that makes someone an administrator: whoever holds it can hand out any role (ADR 0003). */
export const ADMIN_POWER = 'admin.role.assign';

@Injectable()
export class UserRolesService {
  constructor(private readonly context: TenantContext) {}

  /** Serializes everything that can remove an administrator, so two admins cannot remove each other at once. */
  async lockAdministrators(tx: TenantTx): Promise<void> {
    const tenantId = this.context.requireTenantId();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`administrators:${tenantId}`}))`;
  }

  /** Active users, other than the given one (if any), who can still assign roles. */
  countAdministrators(tx: TenantTx, excludeUserId?: string): Promise<number> {
    return tx.user.count({
      where: {
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        status: 'active',
        roles: { some: { role: { permissions: { some: { permissionCode: ADMIN_POWER } } } } },
      },
    });
  }

  async roleIdByKey(tx: TenantTx, key: SystemRole): Promise<string> {
    const role = await tx.role.findFirst({ where: { key }, select: { id: true } });
    if (!role) throw new Error(`System role "${key}" is missing in this workspace; run roles:sync`);
    return role.id;
  }

  /** Throws VALIDATION_FAILED unless every id is a role of this workspace (RLS hides other workspaces' roles). */
  async assertRolesExist(tx: TenantTx, roleIds: string[]): Promise<void> {
    const unique = [...new Set(roleIds)];
    if (unique.length === 0) {
      throw new AppException('VALIDATION_FAILED', {
        details: [{ path: 'roleIds', code: 'too_small', message: 'At least one role is required' }],
      });
    }
    const found = await tx.role.count({ where: { id: { in: unique } } });
    if (found !== unique.length) {
      throw new AppException('VALIDATION_FAILED', {
        details: [{ path: 'roleIds', code: 'unknown_role', message: 'Unknown role' }],
      });
    }
  }

  /**
   * Nobody assigns a custom role they could not have built (docs/adr/0036-role-hierarchy.md): the actor must hold every grant
   * of each newly assigned custom role at its scope or wider. System roles are exempt (their grants are a catalog decision).
   */
  async assertMayAssign(tx: TenantTx, actor: RequestAuth, newRoleIds: string[]): Promise<void> {
    if (newRoleIds.length === 0) return;
    const custom = await tx.role.findMany({
      where: { id: { in: [...new Set(newRoleIds)] }, isSystem: false },
      select: { permissions: { select: { permissionCode: true, scope: true } } },
    });
    const grants = custom.flatMap((role) =>
      role.permissions
        .filter((g) => isValidGrant(g.permissionCode, g.scope))
        .map((g) => ({ code: g.permissionCode, scope: g.scope as PermissionScope })),
    );
    if (escalations(actor.permissions, [], grants).length > 0) {
      throw new AppException('FORBIDDEN', {
        message: 'You cannot assign a role with permissions you do not hold',
        details: [
          { path: 'roleIds', code: 'cannot_assign', message: 'The role grants more than you hold' },
        ],
      });
    }
  }

  /** Replaces all roles of a user. */
  async setRoles(tx: TenantTx, userId: string, roleIds: string[]): Promise<void> {
    const unique = [...new Set(roleIds)];
    await this.assertRolesExist(tx, unique);
    await tx.userRole.deleteMany({ where: { userId, roleId: { notIn: unique } } });
    const have = await tx.userRole.findMany({ where: { userId }, select: { roleId: true } });
    const haveIds = new Set(have.map((r) => r.roleId));
    const missing = unique.filter((id) => !haveIds.has(id));
    if (missing.length > 0) {
      await tx.userRole.createMany({ data: missing.map((roleId) => ({ userId, roleId })) });
    }
  }
}
