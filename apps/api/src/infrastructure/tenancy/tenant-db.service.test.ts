import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext, TenantContextError, type TenantTx } from './tenant-context.js';
import { TenantDb } from './tenant-db.service.js';

const A = '0192f5a0-0000-7000-8000-00000000000a';

function setup() {
  const calls: string[] = [];
  const makeTx = () => {
    const tx = {
      $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push(`${strings.join('?')} [${values.join(',')}]`);
        return 1;
      }),
    };
    return tx as unknown as TenantTx & { $executeRaw: ReturnType<typeof vi.fn> };
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: TenantTx) => Promise<unknown>, options?: unknown) =>
      options === null ? Promise.reject(new Error('unexpected')) : fn(makeTx()),
    ),
  };
  const context = new TenantContext();
  const db = new TenantDb(prisma as unknown as PrismaService, context);
  return { db, context, prisma, calls };
}

describe('TenantDb.tx', () => {
  it('fails before touching the database when no tenant is in context', async () => {
    const { db, prisma } = setup();
    await expect(db.tx(async () => 'x')).rejects.toBeInstanceOf(TenantContextError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('sets the tenant transaction-locally as the first statement, as a bound parameter', async () => {
    const { db, context, calls } = setup();
    const result = await context.run(A, () =>
      db.tx(async () => {
        calls.push('work');
        return 'done';
      }),
    );
    expect(result).toBe('done');
    expect(calls).toEqual([`SELECT set_config('app.tenant_id', ?, true) [${A}]`, 'work']);
  });

  it('reuses the active transaction for nested calls', async () => {
    const { db, context, prisma } = setup();
    await context.run(A, () =>
      db.tx(async (outer) => {
        await db.tx(async (inner) => {
          expect(inner).toBe(outer);
        });
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('opens separate transactions for sequential top-level calls', async () => {
    const { db, context, prisma } = setup();
    await context.run(A, async () => {
      await db.tx(async () => undefined);
      await db.tx(async () => undefined);
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('passes default and custom timeouts to Prisma', async () => {
    const { db, context, prisma } = setup();
    await context.run(A, () => db.tx(async () => undefined));
    expect(prisma.$transaction.mock.calls[0]?.[1]).toEqual({ maxWait: 5_000, timeout: 10_000 });
    await context.run(A, () => db.tx(async () => undefined, { maxWait: 1, timeout: 2 }));
    expect(prisma.$transaction.mock.calls[1]?.[1]).toEqual({ maxWait: 1, timeout: 2 });
  });

  it('propagates errors from the callback (so the transaction rolls back)', async () => {
    const { db, context } = setup();
    await expect(
      context.run(A, () =>
        db.tx(async () => {
          throw new Error('fail');
        }),
      ),
    ).rejects.toThrow('fail');
  });
});

describe('TenantDb.afterCommit', () => {
  it('runs callbacks after the transaction committed, once, in order', async () => {
    const { db, context } = setup();
    const order: string[] = [];
    await context.run(A, () =>
      db.tx(async () => {
        db.afterCommit(() => order.push('first'));
        db.afterCommit(() => order.push('second'));
        order.push('work');
      }),
    );
    expect(order).toEqual(['work', 'first', 'second']);
  });

  it('never runs them when the transaction fails (rolled back)', async () => {
    const { db, context } = setup();
    const callback = vi.fn();
    await expect(
      context.run(A, () =>
        db.tx(async () => {
          db.afterCommit(callback);
          throw new Error('rolled back');
        }),
      ),
    ).rejects.toThrow('rolled back');
    expect(callback).not.toHaveBeenCalled();
  });

  it('nested calls share the outermost transaction’s callbacks', async () => {
    const { db, context } = setup();
    const callback = vi.fn();
    await context.run(A, () =>
      db.tx(async () => {
        await db.tx(async () => db.afterCommit(callback));
        expect(callback).not.toHaveBeenCalled();
      }),
    );
    expect(callback).toHaveBeenCalledOnce();
  });

  it('runs immediately when there is no transaction', () => {
    const { db } = setup();
    const callback = vi.fn();
    db.afterCommit(callback);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('a throwing callback does not fail the request or stop the others', async () => {
    const { db, context } = setup();
    const second = vi.fn();
    await expect(
      context.run(A, () =>
        db.tx(async () => {
          db.afterCommit(() => {
            throw new Error('boom');
          });
          db.afterCommit(second);
          return 'ok';
        }),
      ),
    ).resolves.toBe('ok');
    expect(second).toHaveBeenCalledOnce();
  });
});
