import { Injectable } from '@nestjs/common';
import type { SystemRole } from '@intime/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import type { TenantTx } from '../../infrastructure/tenancy/tenant-context.js';

@Injectable()
export class UserRolesService {
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
