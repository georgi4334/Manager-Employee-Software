import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { APP_CONFIG } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.js';
import { ActivityTracker } from '../../../infrastructure/activity/activity-tracker.js';
import { EmailDispatcher } from './email-dispatcher.service.js';
import { NotificationRetention } from './notification-retention.service.js';
import { RemindersService } from './reminders.service.js';
import { NotificationProcessor } from './notification-processor.service.js';

const BATCH = 20;
const MAX_BATCHES_PER_RUN = 10;
const SWEEP_INTERVAL_MS = 30_000;
const RETENTION_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 3_000;

export interface RunStats {
  events: number;
  emails: number;
  purged: boolean;
}

/**
 * Background delivery. It runs (1) right after a commit that published an event, (2) once shortly after
 * startup and (3) every 30 s, but only while the API has recently served requests — never while idle, so a
 * free-tier database can suspend (docs/adr/0004-notifications.md).
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private sweepTimer?: NodeJS.Timeout;
  private startupTimer?: NodeJS.Timeout;
  private running?: Promise<RunStats>;
  private rerun = false;
  private lastRetentionAt = 0;
  private lastReminderAt = 0;
  private stopped = false;

  constructor(
    @Inject(APP_CONFIG) private readonly env: Env,
    private readonly processor: NotificationProcessor,
    private readonly emails: EmailDispatcher,
    private readonly retention: NotificationRetention,
    private readonly activity: ActivityTracker,
    private readonly reminders: RemindersService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.WORKER_ENABLED) return;
    this.startupTimer = setTimeout(() => this.wake(), STARTUP_DELAY_MS);
    this.sweepTimer = setInterval(() => {
      if (this.activity.isActive()) this.wake();
    }, SWEEP_INTERVAL_MS);
    this.startupTimer.unref();
    this.sweepTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearInterval(this.sweepTimer);
    clearTimeout(this.startupTimer);
    await this.running?.catch(() => undefined);
  }

  /** Fire-and-forget nudge ("there is work"); a no-op when the worker is disabled. */
  wake(): void {
    if (!this.env.WORKER_ENABLED || this.stopped) return;
    void this.runOnce().catch((error: unknown) =>
      this.logger.error({ err: error }, 'Worker run failed'),
    );
  }

  /**
   * One pass: events, then emails, then (at most hourly) retention. Passes never overlap: a request that
   * arrives while one is running makes it go around once more.
   */
  runOnce(now = new Date()): Promise<RunStats> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      let stats: RunStats;
      do {
        this.rerun = false;
        stats = await this.pass(now);
      } while (this.rerun && !this.stopped);
      return stats;
    })().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async pass(now: Date): Promise<RunStats> {
    const stats: RunStats = { events: 0, emails: 0, purged: false };

    try {
      for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
        const events = await this.processor.claim(BATCH, now);
        for (const event of events) await this.processor.process(event, now);
        stats.events += events.length;
        if (events.length < BATCH) break;
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Processing events failed');
    }

    try {
      for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
        const batch = await this.emails.claim(BATCH, now);
        for (const item of batch) await this.emails.send(item, now);
        stats.emails += batch.length;
        if (batch.length < BATCH) break;
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Sending emails failed');
    }

    if (now.getTime() - this.lastRetentionAt >= RETENTION_INTERVAL_MS) {
      try {
        await this.retention.purge(now);
        this.lastRetentionAt = now.getTime();
        stats.purged = true;
      } catch (error) {
        this.logger.error({ err: error }, 'Retention failed');
      }
    }
    // Reminders are time-based: here they only run while the API is busy, the external hook covers quiet hours.
    if (now.getTime() - this.lastReminderAt >= RETENTION_INTERVAL_MS) {
      try {
        const sent = await this.reminders.run(now);
        // Their events are delivered right away, in one more round of this run.
        if (sent.attendance + sent.timers > 0) this.rerun = true;
        this.lastReminderAt = now.getTime();
      } catch (error) {
        this.logger.error({ err: error }, 'Reminders failed');
      }
    }
    return stats;
  }
}
