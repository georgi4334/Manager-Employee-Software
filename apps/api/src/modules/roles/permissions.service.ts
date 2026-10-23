import { Injectable } from '@nestjs/common';
import { mergeGrants, type GrantedPermissions, type RoleSummary } from '@intime/contracts';
import type { TenantTx } from '../../infrastructure/tenancy/tenant-context.js';

export interface UserAccess {
  roles: RoleSummary[];
  permissions: GrantedPermissions;
}

@Injectable()
export class PermissionsService {
  /**
   * What a user may do, read fresh from the database (so role changes apply immediately).
   * Unknown codes and scopes a permission does not allow are ignored: a corrupted row grants nothing.
   * Must run inside the user's tenant transaction.
   */
  async forUser(tx: TenantTx, userId: string): Promise<UserAccess> {
    const assignments = await tx.userRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            key: true,
            name: true,
            permissions: { select: { permissionCode: true, scope: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      roles: assignments.map(({ role }) => ({ key: role.key, name: role.name })),
      permissions: mergeGrants(
        assignments.map(({ role }) =>
          role.permissions.map((g) => ({ code: g.permissionCode, scope: g.scope })),
        ),
      ),
    };
  }
}
