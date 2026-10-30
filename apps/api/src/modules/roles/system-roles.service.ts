import { Injectable } from '@nestjs/common';
import {
  SYSTEM_ROLES,
  SYSTEM_ROLE_LABELS,
  SYSTEM_ROLE_PARENTS,
  systemRoleGrants,
  type PermissionScope,
  type SystemRole,
} from '@intime/contracts';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';

export interface SystemRolesSyncResult {
  roleIds: Record<SystemRole, string>;
  rolesCreated: number;
  grantsAdded: number;
  grantsChanged: number;
  grantsRemoved: number;
}

/**
 * Keeps the four system roles of the current workspace identical to the catalog in @intime/contracts.
 * Runs when a workspace is created and (for all workspaces) from `roles:sync` after a deploy that
 * changes the catalog. Must run inside the tenant's transaction.
 */
@Injectable()
export class SystemRolesService {
  constructor(private readonly context: TenantContext) {}

  async ensureSystemRoles(tx: TenantTx): Promise<SystemRolesSyncResult> {
    const tenantId = this.context.requireTenantId();
    // Two syncs of the same workspace at once (a deploy and a manual run) must queue, not collide.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`system-roles:${tenantId}`}))`;
    const result: SystemRolesSyncResult = {
      roleIds: {} as Record<SystemRole, string>,
      rolesCreated: 0,
      grantsAdded: 0,
      grantsChanged: 0,
      grantsRemoved: 0,
    };

    const created: SystemRole[] = [];
    for (const key of SYSTEM_ROLES) {
      const existing = await tx.role.findUnique({ where: { tenantId_key: { tenantId, key } } });
      const role = existing
        ? await tx.role.update({
            where: { id: existing.id },
            data: { name: SYSTEM_ROLE_LABELS[key], isSystem: true },
          })
        : await tx.role.create({ data: { key, name: SYSTEM_ROLE_LABELS[key], isSystem: true } });
      if (!existing) {
        result.rolesCreated += 1;
        created.push(key);
      }
      result.roleIds[key] = role.id;

      const desired = new Map<string, PermissionScope>(
        systemRoleGrants(key).map((g) => [g.code, g.scope]),
      );
      const current = await tx.rolePermission.findMany({ where: { roleId: role.id } });
      const currentByCode = new Map(current.map((g) => [g.permissionCode, g.scope]));

      const toRemove = current
        .filter((g) => !desired.has(g.permissionCode))
        .map((g) => g.permissionCode);
      if (toRemove.length > 0) {
        await tx.rolePermission.deleteMany({
          where: { roleId: role.id, permissionCode: { in: toRemove } },
        });
        result.grantsRemoved += toRemove.length;
      }

      for (const [code, scope] of desired) {
        const have = currentByCode.get(code);
        if (have === undefined) continue;
        if (have !== scope) {
          await tx.rolePermission.update({
            where: { roleId_permissionCode: { roleId: role.id, permissionCode: code } },
            data: { scope },
          });
          result.grantsChanged += 1;
        }
      }

      const toAdd = [...desired].filter(([code]) => !currentByCode.has(code));
      if (toAdd.length > 0) {
        await tx.rolePermission.createMany({
          data: toAdd.map(([permissionCode, scope]) => ({
            roleId: role.id,
            permissionCode,
            scope,
          })),
        });
        result.grantsAdded += toAdd.length;
      }
    }
    // New roles start in the default tree (docs/adr/0036-role-hierarchy.md); an existing placement is never changed.
    for (const key of created) {
      const parent = SYSTEM_ROLE_PARENTS[key];
      if (parent === null) continue;
      await tx.role.update({
        where: { id: result.roleIds[key] },
        data: { parentId: result.roleIds[parent] },
      });
    }
    return result;
  }
}
