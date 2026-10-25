import { Injectable, Logger } from '@nestjs/common';
import { OPEN_ATTENDANCE_REMINDER_HOURS, RUNNING_TIMER_REMINDER_HOURS } from '@intime/contracts';
import { SystemPrismaService } from '../../../infrastructure/prisma/system-prisma.service.js';
import { TenantContext } from '../../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../../infrastructure/tenancy/tenant-db.service.js';
import type { TenantTx } from '../../../infrastructure/tenancy/tenant-context.js';
import { EVENT_DEFINITIONS } from '../events.js';

const HOUR_MS = 3_600_000;
/** Per workspace and run; what is left is picked up by the next run. */
const BATCH = 500;

export interface ReminderStats {
  attendance: number;
  timers: number;
}

/**
 * Reports forgotten check-outs and timers left running, once each (docs/adr/0017-integrations.md). The system
 * connection only lists the workspaces; everything else runs inside the tenant like any request.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly system: SystemPrismaService,
    private readonly context: TenantContext,
    private readonly db: TenantDb,
  ) {}

  async run(now = new Date()): Promise<ReminderStats> {
    const stats: ReminderStats = { attendance: 0, timers: 0 };
    const tenants = await this.system.tenant.findMany({ select: { id: true } });
    for (const { id } of tenants) {
      try {
        const done = await this.context.run(id, () => this.forTenant(now));
        stats.attendance += done.attendance;
        stats.timers += done.timers;
      } catch (error) {
        this.logger.error({ err: error, tenantId: id }, 'Reminders failed for a workspace');
      }
    }
    return stats;
  }

  /**
   * Queues the notification event in the same transaction. (OutboxService is not used here: the worker that
   * runs this service depends on it, and the worker is woken by whoever calls run.)
   */
  private async queue(
    tx: TenantTx,
    type: 'attendance.reminder' | 'time.timer_reminder',
    params: { recipientUserId: string; date: string },
  ): Promise<void> {
    const parsed = EVENT_DEFINITIONS[type].params.parse(params);
    await tx.outboxEvent.createMany({ data: [{ type, params: parsed }] });
  }

  private forTenant(now: Date): Promise<ReminderStats> {
    return this.db.tx(async (tx) => {
      const day = (date: Date) => date.toISOString().slice(0, 10);
      let attendance = 0;
      let timers = 0;

      const open = await tx.attendanceRecord.findMany({
        where: {
          checkOutAt: null,
          remindedAt: null,
          checkInAt: { lte: new Date(now.getTime() - OPEN_ATTENDANCE_REMINDER_HOURS * HOUR_MS) },
        },
        select: { id: true, workDate: true, employee: { select: { userId: true, status: true } } },
        orderBy: { checkInAt: 'asc' },
        take: BATCH,
      });
      for (const record of open) {
        // Claim first: a second run (or a second server) finds it taken.
        const claimed = await tx.attendanceRecord.updateMany({
          where: { id: record.id, remindedAt: null, checkOutAt: null },
          data: { remindedAt: now },
        });
        if (claimed.count !== 1) continue;
        attendance += 1;
        if (record.employee.userId && record.employee.status === 'active') {
          await this.queue(tx, 'attendance.reminder', {
            recipientUserId: record.employee.userId,
            date: day(record.workDate),
          });
        }
      }

      const running = await tx.timeEntry.findMany({
        where: {
          source: 'timer',
          endedAt: null,
          remindedAt: null,
          startedAt: { lte: new Date(now.getTime() - RUNNING_TIMER_REMINDER_HOURS * HOUR_MS) },
        },
        select: { id: true, workDate: true, employee: { select: { userId: true, status: true } } },
        orderBy: { startedAt: 'asc' },
        take: BATCH,
      });
      for (const entry of running) {
        const claimed = await tx.timeEntry.updateMany({
          where: { id: entry.id, remindedAt: null, endedAt: null },
          data: { remindedAt: now },
        });
        if (claimed.count !== 1) continue;
        timers += 1;
        if (entry.employee.userId && entry.employee.status === 'active') {
          await this.queue(tx, 'time.timer_reminder', {
            recipientUserId: entry.employee.userId,
            date: day(entry.workDate),
          });
        }
      }
      return { attendance, timers };
    });
  }
}
