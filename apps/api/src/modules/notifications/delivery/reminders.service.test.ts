import { describe, expect, it, vi } from 'vitest';
import type { SystemPrismaService } from '../../../infrastructure/prisma/system-prisma.service.js';
import type { TenantContext } from '../../../infrastructure/tenancy/tenant-context.js';
import type { TenantDb } from '../../../infrastructure/tenancy/tenant-db.service.js';
import { RemindersService } from './reminders.service.js';

const USER = '0192f5a0-0000-7000-8000-00000000000a';
const NOW = new Date('2026-10-26T20:00:00Z');

/** A workspace with one overdue record and one overdue timer; `claim` decides what the conditional updates report. */
function build(claim: { count: number }, employee = { userId: USER, status: 'active' }) {
  const row = { id: 'r1', workDate: new Date('2026-10-26T00:00:00Z'), employee };
  const tx = {
    attendanceRecord: { findMany: vi.fn(async () => [row]), updateMany: vi.fn(async () => claim) },
    timeEntry: { findMany: vi.fn(async () => [row]), updateMany: vi.fn(async () => claim) },
    outboxEvent: { createMany: vi.fn(async () => ({ count: 1 })) },
  };
  const system = { tenant: { findMany: vi.fn(async () => [{ id: 't1' }, { id: 't2' }]) } };
  const context = { run: vi.fn(<T>(_id: string, fn: () => T) => fn()) };
  const db = { tx: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const service = new RemindersService(
    system as unknown as SystemPrismaService,
    context as unknown as TenantContext,
    db as unknown as TenantDb,
  );
  return { service, tx, context, db };
}

describe('RemindersService (claiming)', () => {
  it('claims each record with a condition that fails when it was reminded or finished meanwhile', async () => {
    const { service, tx } = build({ count: 1 });
    await service.run(NOW);
    expect(tx.attendanceRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', remindedAt: null, checkOutAt: null },
      data: { remindedAt: NOW },
    });
    expect(tx.timeEntry.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', remindedAt: null, endedAt: null },
      data: { remindedAt: NOW },
    });
  });

  it('sends nothing for a record somebody else claimed first', async () => {
    const { service, tx } = build({ count: 0 });
    const stats = await service.run(NOW);
    expect(stats).toEqual({ attendance: 0, timers: 0 });
    expect(tx.outboxEvent.createMany).not.toHaveBeenCalled();
  });

  it('queues one event per claimed record, per workspace, inside the workspace', async () => {
    const { service, tx, context } = build({ count: 1 });
    const stats = await service.run(NOW);
    expect(context.run.mock.calls.map((c) => c[0])).toEqual(['t1', 't2']);
    expect(stats).toEqual({ attendance: 2, timers: 2 });
    expect(tx.outboxEvent.createMany).toHaveBeenCalledTimes(4);
    expect(tx.outboxEvent.createMany).toHaveBeenCalledWith({
      data: [
        { type: 'attendance.reminder', params: { recipientUserId: USER, date: '2026-10-26' } },
      ],
    });
  });

  it('claims but does not notify an inactive person or a record without an account', async () => {
    for (const employee of [
      { userId: USER, status: 'inactive' },
      { userId: null as unknown as string, status: 'active' },
    ]) {
      const { service, tx } = build({ count: 1 }, employee);
      const stats = await service.run(NOW);
      expect(stats).toEqual({ attendance: 2, timers: 2 });
      expect(tx.outboxEvent.createMany).not.toHaveBeenCalled();
    }
  });

  it('carries on with the other workspaces when one fails', async () => {
    const { service, tx, db } = build({ count: 1 });
    db.tx.mockRejectedValueOnce(new Error('db down'));
    const stats = await service.run(NOW);
    expect(stats).toEqual({ attendance: 1, timers: 1 });
    expect(tx.outboxEvent.createMany).toHaveBeenCalledTimes(2);
  });
});
