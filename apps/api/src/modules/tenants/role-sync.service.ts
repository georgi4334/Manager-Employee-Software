import { Injectable } from '@nestjs/common';
import { SystemPrismaService } from '../../infrastructure/prisma/system-prisma.service.js';
import { TenantContext } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { SystemRolesService, type SystemRolesSyncResult } from '../roles/system-roles.service.js';

@Injectable()
export class RoleSyncService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly context: TenantContext,
    private readonly db: TenantDb,
    private readonly systemRoles: SystemRolesService,
  ) {}

  /** Brings the system roles of every workspace in line with the catalog (run after deploys). */
  async syncAll(): Promise<{ slug: string; result: SystemRolesSyncResult }[]> {
    const tenants = await this.system.tenant.findMany({
      select: { id: true, slug: true },
      orderBy: { slug: 'asc' },
    });
    const results: { slug: string; result: SystemRolesSyncResult }[] = [];
    for (const tenant of tenants) {
      const result = await this.context.run(tenant.id, () =>
        this.db.tx((tx) => this.systemRoles.ensureSystemRoles(tx)),
      );
      results.push({ slug: tenant.slug, result });
    }
    return results;
  }
}
