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

  /**
   * Runs the callback after the current transaction has committed (never when it rolled back); immediately
   * when there is no transaction. For nudges such as "new outbox event, wake the worker".
   */
  afterCommit(callback: () => void): void {
    const hooks = this.context.getAfterCommit();
    if (hooks) hooks.push(callback);
    else callback();
  }

  async tx<T>(fn: (tx: TenantTx) => Promise<T>, options: TenantTxOptions = {}): Promise<T> {
    const tenantId = this.context.requireTenantId();

    const active = this.context.getTx();
    if (active) return fn(active);

    const afterCommit: (() => void)[] = [];
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return this.context.runWithTx(tx, () => fn(tx), afterCommit);
      },
      { maxWait: options.maxWait ?? 5_000, timeout: options.timeout ?? 10_000 },
    );
    // Only reached when the transaction committed. A failing callback must never fail the request.
    for (const callback of afterCommit) {
      try {
        callback();
      } catch {
        // Callbacks are best-effort nudges (e.g. waking the worker); the sweep catches up anyway.
      }
    }
    return result;
  }
}
