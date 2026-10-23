import { describe, expect, it, vi } from 'vitest';
import type { TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import type { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import type { OutboxWorker } from './delivery/outbox-worker.service.js';
import { OutboxService } from './outbox.service.js';

const USER = '0192f5a0-0000-7000-8000-00000000000a';

function setup() {
  const createMany = vi.fn(async () => ({ count: 1 }));
  const tx = { outboxEvent: { createMany } } as unknown as TenantTx;
  const hooks: (() => void)[] = [];
  const db = { afterCommit: (callback: () => void) => hooks.push(callback) } as unknown as TenantDb;
  const wake = vi.fn();
  const service = new OutboxService(db, { wake } as unknown as OutboxWorker);
  return { service, tx, createMany, hooks, wake };
}

describe('OutboxService.publish', () => {
  it('stores the event with validated parameters (inside the caller’s transaction)', async () => {
    const { service, tx, createMany } = setup();
    await service.publish(tx, 'user.roles_changed', { userId: USER, roleNames: [' HR '] });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ type: 'user.roles_changed', params: { userId: USER, roleNames: ['HR'] } }],
    });
  });

  it('wakes the worker only after the commit, never before', async () => {
    const { service, tx, hooks, wake } = setup();
    await service.publish(tx, 'user.roles_changed', { userId: USER, roleNames: ['HR'] });
    expect(wake).not.toHaveBeenCalled();
    expect(hooks).toHaveLength(1);
    hooks[0]?.();
    expect(wake).toHaveBeenCalledOnce();
  });

  it('refuses invalid parameters, stores nothing and registers no wake-up', async () => {
    const { service, tx, createMany, hooks } = setup();
    await expect(
      service.publish(tx, 'user.roles_changed', { userId: 'maria', roleNames: [] }),
    ).rejects.toThrow();
    expect(createMany).not.toHaveBeenCalled();
    expect(hooks).toHaveLength(0);
  });
});
