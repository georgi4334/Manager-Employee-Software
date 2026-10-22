import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext, type TenantTx } from './tenant-context.js';

export interface TenantTxOptions {
  /** Max time to wait for a free connection (a sleeping free-tier database needs a moment). */
  maxWait?: number;
  /** Max time the whole transaction may take. */
  timeout?: number;
}

/**
 * The only way feature code reads or writes tenant data. Every call runs in a transaction whose first
 * statement sets app.tenant_id (transaction-local), so PostgreSQL RLS limits all queries to that tenant
 * and the setting cannot leak to another request using the same pooled connection.
 */
@Injectable()
export class TenantDb {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContext,
  ) {}

  async tx<T>(fn: (tx: TenantTx) => Promise<T>, options: TenantTxOptions = {}): Promise<T> {
    const tenantId = this.context.requireTenantId();

    const active = this.context.getTx();
    if (active) return fn(active);

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return this.context.runWithTx(tx, () => fn(tx));
      },
      { maxWait: options.maxWait ?? 5_000, timeout: options.timeout ?? 10_000 },
    );
  }
}
