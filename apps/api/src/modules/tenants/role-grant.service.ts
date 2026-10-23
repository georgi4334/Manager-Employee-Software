import { Injectable } from '@nestjs/common';
import {
  SYSTEM_ROLES,
  normalizeEmail,
  workspaceSlugSchema,
  type SystemRole,
} from '@intime/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { SystemPrismaService } from '../../infrastructure/prisma/system-prisma.service.js';
import { TenantContext } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SystemRolesService } from '../roles/system-roles.service.js';

/**
 * Operator tool (command line): adds a system role to an existing user. Used to hand the first Admin role to
 * accounts created before roles existed, and to recover a workspace whose administrators are locked out.
 */
@Injectable()
export class RoleGrantService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly context: TenantContext,
    private readonly db: TenantDb,
    private readonly systemRoles: SystemRolesService,
    private readonly audit: AuditService,
  ) {}

  async grant(input: {
    workspace: string;
    email: string;
    role: string;
  }): Promise<{ userId: string; roleKey: SystemRole; added: boolean }> {
    const slug = workspaceSlugSchema.safeParse(input.workspace);
    if (!slug.success)
      throw new AppException('VALIDATION_FAILED', { message: 'Invalid workspace' });
    if (!(SYSTEM_ROLES as readonly string[]).includes(input.role)) {
      throw new AppException('VALIDATION_FAILED', {
        message: `Role must be one of: ${SYSTEM_ROLES.join(', ')}`,
      });
    }
    const roleKey = input.role as SystemRole;

    const tenant = await this.system.tenant.findUnique({
      where: { slug: slug.data },
      select: { id: true },
    });
    if (!tenant) throw new AppException('NOT_FOUND', { message: 'Workspace not found' });

    return this.context.run(tenant.id, () =>
      this.db.tx(async (tx) => {
        const user = await tx.user.findFirst({
          where: { email: normalizeEmail(input.email) },
          select: { id: true },
        });
        if (!user)
          throw new AppException('NOT_FOUND', { message: 'User not found in this workspace' });

        const { roleIds } = await this.systemRoles.ensureSystemRoles(tx);
        const roleId = roleIds[roleKey];
        const existing = await tx.userRole.findUnique({
          where: { userId_roleId: { userId: user.id, roleId } },
        });
        if (existing) return { userId: user.id, roleKey, added: false };

        await tx.userRole.create({ data: { userId: user.id, roleId } });
        await this.audit.record(tx, {
          actorUserId: null,
          action: 'user.role_granted',
          entity: 'user',
          entityId: user.id,
          after: { roleIds: [roleId] },
        });
        return { userId: user.id, roleKey, added: true };
      }),
    );
  }
}
