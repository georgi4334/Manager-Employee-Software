import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

export type TenantTx = Prisma.TransactionClient;

interface TenantStore {
  tenantId?: string;
  tx?: TenantTx;
  /** Callbacks to run once the outermost transaction has committed. */
  afterCommit?: (() => void)[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** A programming error: tenant-scoped code ran without an authenticated tenant. Surfaces as a 500. */
export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantContextError';
  }
}

function assertUuid(tenantId: unknown): asserts tenantId is string {
  if (!isUuid(tenantId)) throw new TenantContextError('Tenant id must be a UUID');
}

/**
 * Holds the current tenant for the running request or job (AsyncLocalStorage), so it never has to be
 * passed through every function and cannot be confused between concurrent requests.
 */
@Injectable()
export class TenantContext {
  private readonly storage = new AsyncLocalStorage<TenantStore>();

  /** Starts an empty context for an HTTP request; authentication fills in the tenant. */
  runEmpty<T>(fn: () => T): T {
    return this.storage.run({}, fn);
  }

  /** Runs fn as the given tenant (background jobs, tests, system tasks acting for one tenant). */
  run<T>(tenantId: string, fn: () => T): T {
    assertUuid(tenantId);
    return this.storage.run({ tenantId }, fn);
  }

  /** Sets the tenant once per context (called by authentication). Switching tenants is refused. */
  setTenantId(tenantId: string): void {
    assertUuid(tenantId);
    const store = this.storage.getStore();
    if (!store) throw new TenantContextError('No tenant context is active');
    if (store.tenantId !== undefined && store.tenantId !== tenantId) {
      throw new TenantContextError('Tenant is already set for this context');
    }
    store.tenantId = tenantId;
  }

  getTenantId(): string | undefined {
    return this.storage.getStore()?.tenantId;
  }

  requireTenantId(): string {
    const tenantId = this.getTenantId();
    if (!tenantId) throw new TenantContextError('No tenant in context');
    return tenantId;
  }

  getTx(): TenantTx | undefined {
    return this.storage.getStore()?.tx;
  }

  /** Runs fn with tx as the active transaction; nested TenantDb.tx calls reuse it. */
  runWithTx<T>(tx: TenantTx, fn: () => T, afterCommit?: (() => void)[]): T {
    return this.storage.run({ ...this.storage.getStore(), tx, afterCommit }, fn);
  }

  /** Callbacks waiting for the active transaction to commit; undefined outside a transaction. */
  getAfterCommit(): (() => void)[] | undefined {
    return this.storage.getStore()?.afterCommit;
  }
}
