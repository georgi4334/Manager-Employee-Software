import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TenantTx } from '../../infrastructure/tenancy/tenant-context.js';

export interface AuditEntry {
  /** The signed-in user; null for system actions (CLI, jobs). */
  actorUserId: string | null;
  /** Dotted verb, e.g. "user.disabled". */
  action: string;
  entity: string;
  entityId?: string;
  /** Only ids, role keys and statuses: no secrets and no personal data beyond what identifies the record. */
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/** The audit log is append-only (database privileges); this service only ever inserts. */
@Injectable()
export class AuditService {
  async record(tx: TenantTx, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorUserId: entry.actorUserId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: entry.before,
        after: entry.after,
      },
    });
  }
}
