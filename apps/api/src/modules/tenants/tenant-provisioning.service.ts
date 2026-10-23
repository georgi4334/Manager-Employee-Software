import { Injectable } from '@nestjs/common';
import { emailSchema, workspaceSlugSchema } from '@intime/contracts';
import { z } from 'zod';
import { AppException } from '../../common/errors/app-exception.js';
import { zodIssuesToDetails } from '../../common/errors/map-exception.js';
import { SystemPrismaService } from '../../infrastructure/prisma/system-prisma.service.js';
import { TenantContext } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { InvitationService } from '../auth/invitation.service.js';
import { SystemRolesService } from '../roles/system-roles.service.js';

export const createTenantInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: workspaceSlugSchema,
  adminEmail: emailSchema,
  adminFirstName: z.string().trim().min(1).max(100).default('Workspace'),
  adminLastName: z.string().trim().min(1).max(100).default('Administrator'),
  locale: z.enum(['en', 'de', 'bg']).default('en'),
  timezone: z.string().min(1).default('Europe/Sofia'),
});
export type CreateTenantInput = z.input<typeof createTenantInputSchema>;

/** Platform-operator task: a new workspace plus an invitation for its first admin. */
@Injectable()
export class TenantProvisioningService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly context: TenantContext,
    private readonly db: TenantDb,
    private readonly invitations: InvitationService,
    private readonly systemRoles: SystemRolesService,
    private readonly audit: AuditService,
  ) {}

  async create(
    raw: CreateTenantInput,
  ): Promise<{ tenantId: string; adminUserId: string; invitationLink: string }> {
    const parsed = createTenantInputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppException('VALIDATION_FAILED', { details: zodIssuesToDetails(parsed.error) });
    }
    const input = parsed.data;

    if (
      await this.system.tenant.findUnique({ where: { slug: input.slug }, select: { id: true } })
    ) {
      throw new AppException('CONFLICT', {
        message: 'Workspace slug is taken',
        params: { field: 'slug' },
      });
    }
    const tenant = await this.system.tenant.create({
      data: {
        name: input.name,
        slug: input.slug,
        defaultLocale: input.locale,
        defaultTimezone: input.timezone,
      },
      select: { id: true },
    });
    const { userId, link } = await this.context.run(tenant.id, () =>
      this.db.tx(async (tx) => {
        const { roleIds } = await this.systemRoles.ensureSystemRoles(tx);
        const invited = await this.invitations.invite(tx, input.adminEmail, [roleIds.admin]);
        // The administrator is an employee too (the directory, leave and the calendar start from there).
        await tx.employee.create({
          data: {
            userId: invited.userId,
            firstName: input.adminFirstName,
            lastName: input.adminLastName,
          },
        });
        await this.audit.record(tx, {
          actorUserId: null,
          action: 'tenant.created',
          entity: 'tenant',
          entityId: tenant.id,
          after: { slug: input.slug, adminUserId: invited.userId },
        });
        return invited;
      }),
    );
    return { tenantId: tenant.id, adminUserId: userId, invitationLink: link };
  }
}
