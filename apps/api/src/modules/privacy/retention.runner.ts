import { Injectable, Logger } from '@nestjs/common';
import { RETENTION_BATCH, isRetentionDue } from '@intime/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { SystemPrismaService } from '../../infrastructure/prisma/system-prisma.service.js';
import { TenantContext } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { workspaceToday } from '../projects/projects.present.js';
import { dateOut } from '../projects/projects.shared.js';
import { ErasureService } from './erasure.service.js';
import { loadPolicy } from './retention.service.js';

const HOUR_MS = 3_600_000;
/** A workspace is checked once a day; a full batch is continued at the next hourly run. */
const MIN_INTERVAL_MS = 23 * HOUR_MS;

/**
 * Automatic anonymisation of former employees (docs/adr/0027-retention-bulgaria.md). The system connection only lists the
 * workspaces; the policy and candidates are read inside the tenant, and each erasure goes through ErasureService.
 */
@Injectable()
export class RetentionRunner {
  private readonly logger = new Logger(RetentionRunner.name);

  constructor(
    private readonly system: SystemPrismaService,
    private readonly context: TenantContext,
    private readonly db: TenantDb,
    private readonly erasure: ErasureService,
  ) {}

  /** Returns how many people were anonymised in all workspaces. */
  async run(now = new Date()): Promise<number> {
    let erased = 0;
    const tenants = await this.system.tenant.findMany({ select: { id: true } });
    for (const { id } of tenants) {
      try {
        erased += await this.context.run(id, () => this.forTenant(id, now));
      } catch (error) {
        this.logger.error({ err: error, tenantId: id }, 'Retention failed for a workspace');
      }
    }
    return erased;
  }

  private async forTenant(tenantId: string, now: Date): Promise<number> {
    const plan = await this.db.tx(async (tx) => {
      const policy = await loadPolicy(tx);
      if (!policy.enabled) return null;
      if (policy.lastRunAt && now.getTime() - Date.parse(policy.lastRunAt) < MIN_INTERVAL_MS) {
        return null;
      }
      const today = await workspaceToday(tx, this.context);
      const rows = await tx.employee.findMany({
        where: {
          status: 'inactive',
          erasedAt: null,
          retentionHold: false,
          terminationDate: { not: null },
        },
        select: { id: true, terminationDate: true },
        orderBy: [{ terminationDate: 'asc' }, { id: 'asc' }],
      });
      const due = rows.filter((r) =>
        isRetentionDue(dateOut(r.terminationDate!), policy.formerEmployeeMonths, today),
      );
      return {
        ids: due.slice(0, RETENTION_BATCH).map((r) => r.id),
        more: due.length > RETENTION_BATCH,
      };
    });
    if (!plan) return 0;

    let erased = 0;
    for (const employeeId of plan.ids) {
      try {
        await this.erasure.erase(tenantId, null, employeeId);
        erased += 1;
      } catch (error) {
        // Reactivated, put on hold or erased by HR in the meantime: nothing to do.
        if (!(error instanceof AppException)) {
          this.logger.error({ err: error, tenantId, employeeId }, 'Automatic erasure failed');
        }
      }
    }
    // A full batch leaves the last-run time alone, so the next hourly run continues at once.
    if (!plan.more) {
      await this.db.tx(async (tx) => {
        const row = await tx.retentionPolicy.findFirst();
        if (row) {
          await tx.retentionPolicy.update({
            where: { id: row.id },
            data: { lastRunAt: now, lastRunErased: erased },
          });
        }
      });
    }
    return erased;
  }
}
