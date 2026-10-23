import { Injectable } from '@nestjs/common';
import { SystemPrismaService } from '../../../infrastructure/prisma/system-prisma.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION = {
  readNotificationDays: 90,
  unreadNotificationDays: 180,
  doneEventDays: 30,
  deadEventDays: 90,
} as const;

/** GDPR data minimization: notifications and queue entries do not live forever. */
@Injectable()
export class NotificationRetention {
  constructor(private readonly system: SystemPrismaService) {}

  async purge(now: Date): Promise<{ notifications: number; events: number }> {
    const before = (days: number) => new Date(now.getTime() - days * DAY_MS);

    const notifications = await this.system.notification.deleteMany({
      where: {
        OR: [
          { readAt: { lt: before(RETENTION.readNotificationDays) } },
          { readAt: null, createdAt: { lt: before(RETENTION.unreadNotificationDays) } },
        ],
        // Never delete an email that is still waiting to be sent.
        NOT: { emailStatus: { in: ['pending', 'sending'] } },
      },
    });
    const events = await this.system.outboxEvent.deleteMany({
      where: {
        OR: [
          { status: 'done', processedAt: { lt: before(RETENTION.doneEventDays) } },
          { status: 'dead', createdAt: { lt: before(RETENTION.deadEventDays) } },
        ],
      },
    });
    return { notifications: notifications.count, events: events.count };
  }
}
