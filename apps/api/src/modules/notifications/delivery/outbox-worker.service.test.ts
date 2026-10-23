import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testEnv } from '../../../../test/helpers.js';
import {
  ACTIVE_WINDOW_MS,
  ActivityTracker,
} from '../../../infrastructure/activity/activity-tracker.js';
import type { EmailDispatcher } from './email-dispatcher.service.js';
import type { NotificationProcessor } from './notification-processor.service.js';
import type { NotificationRetention } from './notification-retention.service.js';
import { OutboxWorker } from './outbox-worker.service.js';

function build(options: { enabled?: boolean } = {}) {
  const processor = {
    claim: vi.fn(async () => [] as { id: string }[]),
    process: vi.fn(async (): Promise<'done' | 'retry' | 'dead'> => 'done'),
  };
  const emails = {
    claim: vi.fn(async () => [] as { id: string }[]),
    send: vi.fn(async () => 'sent' as const),
  };
  const retention = { purge: vi.fn(async () => ({ notifications: 0, events: 0 })) };
  const activity = new ActivityTracker();
  const worker = new OutboxWorker(
    testEnv({ WORKER_ENABLED: String(options.enabled ?? true) }),
    processor as unknown as NotificationProcessor,
    emails as unknown as EmailDispatcher,
    retention as unknown as NotificationRetention,
    activity,
  );
  return { worker, processor, emails, retention, activity };
}

describe('OutboxWorker.runOnce', () => {
  it('claims events, processes each, then sends emails', async () => {
    const { worker, processor, emails } = build();
    processor.claim.mockResolvedValueOnce([{ id: 'e1' }, { id: 'e2' }]);
    emails.claim.mockResolvedValueOnce([{ id: 'n1' }]);
    const stats = await worker.runOnce(new Date('2026-10-23T10:00:00Z'));
    expect(stats).toMatchObject({ events: 2, emails: 1 });
    expect(processor.process).toHaveBeenCalledTimes(2);
    expect(emails.send).toHaveBeenCalledTimes(1);
  });

  it('keeps taking batches while they are full, and stops at the first short one', async () => {
    const { worker, processor } = build();
    const full = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}` }));
    processor.claim
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([{ id: 'last' }]);
    const stats = await worker.runOnce();
    expect(stats.events).toBe(41);
    expect(processor.claim).toHaveBeenCalledTimes(3);
  });

  it('does nothing else when there is nothing to do', async () => {
    const { worker, processor, emails } = build();
    expect(await worker.runOnce()).toMatchObject({ events: 0, emails: 0 });
    expect(processor.process).not.toHaveBeenCalled();
    expect(emails.send).not.toHaveBeenCalled();
  });

  it('runs retention at most once per hour', async () => {
    const { worker, retention } = build();
    const t0 = new Date('2026-10-23T10:00:00Z');
    expect((await worker.runOnce(t0)).purged).toBe(true);
    expect((await worker.runOnce(new Date(t0.getTime() + 30 * 60_000))).purged).toBe(false);
    expect((await worker.runOnce(new Date(t0.getTime() + 61 * 60_000))).purged).toBe(true);
    expect(retention.purge).toHaveBeenCalledTimes(2);
  });

  it('a failing step does not stop the others and does not throw', async () => {
    const { worker, processor, emails, retention } = build();
    processor.claim.mockRejectedValueOnce(new Error('db down'));
    emails.claim.mockResolvedValueOnce([{ id: 'n1' }]);
    retention.purge.mockRejectedValueOnce(new Error('db down'));
    const stats = await worker.runOnce();
    expect(stats).toMatchObject({ events: 0, emails: 1, purged: false });
  });

  it('a failing event does not stop the rest of the batch', async () => {
    const { worker, processor } = build();
    processor.claim.mockResolvedValueOnce([{ id: 'e1' }, { id: 'e2' }]);
    processor.process.mockResolvedValueOnce('retry').mockResolvedValueOnce('done');
    await worker.runOnce();
    expect(processor.process).toHaveBeenCalledTimes(2);
  });

  it('passes never overlap: a nudge during a run makes it go around once more', async () => {
    const { worker, processor } = build();
    let release = () => {};
    processor.claim.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([]))),
    );
    const first = worker.runOnce();
    const second = worker.runOnce();
    expect(second).toBe(first);
    release();
    await first;
    // One pass for the original run, one more because of the nudge.
    expect(processor.claim).toHaveBeenCalledTimes(2);
  });
});

describe('OutboxWorker.wake', () => {
  it('is a no-op when the worker is disabled', async () => {
    const { worker, processor } = build({ enabled: false });
    worker.wake();
    await Promise.resolve();
    expect(processor.claim).not.toHaveBeenCalled();
  });

  it('runs a pass when enabled', async () => {
    const { worker, processor } = build();
    worker.wake();
    await vi.waitFor(() => expect(processor.claim).toHaveBeenCalled());
  });
});

describe('OutboxWorker sweep (never wakes an idle database)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not run at all when disabled', async () => {
    const { worker, processor, activity } = build({ enabled: false });
    activity.touch(Date.now());
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(processor.claim).not.toHaveBeenCalled();
    await worker.onModuleDestroy();
  });

  it('runs once shortly after startup (to finish what a previous run left), then sweeps only while active', async () => {
    const { worker, processor, activity } = build();
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(3_100);
    expect(processor.claim).toHaveBeenCalledTimes(1);

    // Nobody has used the API: sweeps must not touch the database.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(processor.claim).toHaveBeenCalledTimes(1);

    // Somebody uses it: sweeps resume.
    activity.touch(Date.now());
    await vi.advanceTimersByTimeAsync(31_000);
    expect(processor.claim).toHaveBeenCalledTimes(2);

    // They leave: after the window the sweeps stop again.
    await vi.advanceTimersByTimeAsync(ACTIVE_WINDOW_MS + 31_000);
    const callsAfterWindow = processor.claim.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(processor.claim.mock.calls.length).toBe(callsAfterWindow);
    await worker.onModuleDestroy();
  });

  it('stops cleanly on shutdown (no timers left, no new runs)', async () => {
    const { worker, processor, activity } = build();
    activity.touch(Date.now());
    worker.onApplicationBootstrap();
    await worker.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    worker.wake();
    expect(processor.claim).not.toHaveBeenCalled();
  });
});
