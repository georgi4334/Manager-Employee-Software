import { Injectable } from '@nestjs/common';
import {
  NOTIFICATION_TYPE_KEYS,
  isNotificationChannel,
  resolveChannels,
  type NotificationChannel,
  type NotificationItem,
  type NotificationList,
  type NotificationPreference,
  type NotificationQuery,
  type UpdateNotificationPreference,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AppException } from '../../common/errors/app-exception.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import type { TenantTx } from '../../infrastructure/tenancy/tenant-context.js';

interface NotificationRow {
  id: string;
  type: string;
  params: unknown;
  link: string;
  readAt: Date | null;
  createdAt: Date;
}

const toItem = (row: NotificationRow): NotificationItem => ({
  id: row.id,
  type: row.type,
  params:
    row.params && typeof row.params === 'object' && !Array.isArray(row.params)
      ? (row.params as Record<string, unknown>)
      : {},
  link: row.link,
  readAt: row.readAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/** A person's own inbox and preferences. Everything here is scoped to the caller. */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: TenantDb) {}

  private inbox(actor: RequestAuth) {
    return { recipientUserId: actor.userId, inApp: true } as const;
  }

  list(actor: RequestAuth, query: NotificationQuery): Promise<NotificationList> {
    return this.db.tx(async (tx) => {
      const rows = await tx.notification.findMany({
        where: {
          ...this.inbox(actor),
          ...(query.before ? { id: { lt: query.before } } : {}),
          ...(query.unreadOnly ? { readAt: null } : {}),
        },
        select: { id: true, type: true, params: true, link: true, readAt: true, createdAt: true },
        // Ids are time-ordered UUIDs, so this is newest first and the cursor is stable.
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      return {
        items: page.map(toItem),
        unreadCount: await this.countUnread(tx, actor),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  unreadCount(actor: RequestAuth): Promise<number> {
    return this.db.tx((tx) => this.countUnread(tx, actor));
  }

  private countUnread(tx: TenantTx, actor: RequestAuth): Promise<number> {
    return tx.notification.count({ where: { ...this.inbox(actor), readAt: null } });
  }

  /** Idempotent. Somebody else's (or a missing) notification is "not found", never "forbidden". */
  markRead(actor: RequestAuth, id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const mine = await tx.notification.findFirst({
        where: { id, ...this.inbox(actor) },
        select: { id: true },
      });
      if (!mine) throw new AppException('NOT_FOUND', { message: 'Notification not found' });
      await tx.notification.updateMany({
        where: { id, readAt: null },
        data: { readAt: new Date() },
      });
    });
  }

  markAllRead(actor: RequestAuth): Promise<{ updated: number }> {
    return this.db.tx(async (tx) => {
      const result = await tx.notification.updateMany({
        where: { ...this.inbox(actor), readAt: null },
        data: { readAt: new Date() },
      });
      return { updated: result.count };
    });
  }

  listPreferences(actor: RequestAuth): Promise<NotificationPreference[]> {
    return this.db.tx(async (tx) => {
      const stored = await tx.notificationPreference.findMany({
        where: { userId: actor.userId },
        select: { type: true, channel: true, enabled: true },
      });
      return NOTIFICATION_TYPE_KEYS.map((type) => this.toPreference(type, stored));
    });
  }

  updatePreference(
    actor: RequestAuth,
    update: UpdateNotificationPreference,
  ): Promise<NotificationPreference> {
    return this.db.tx(async (tx) => {
      const current = resolveChannels(update.type)[update.channel];
      if (current.locked) {
        throw new AppException('VALIDATION_FAILED', {
          message: 'This notification cannot be switched off',
          details: [{ path: 'channel', code: 'locked', message: 'Locked channel' }],
        });
      }
      await tx.notificationPreference.upsert({
        where: {
          userId_type_channel: { userId: actor.userId, type: update.type, channel: update.channel },
        },
        create: {
          userId: actor.userId,
          type: update.type,
          channel: update.channel,
          enabled: update.enabled,
        },
        update: { enabled: update.enabled },
      });
      const stored = await tx.notificationPreference.findMany({
        where: { userId: actor.userId, type: update.type },
        select: { type: true, channel: true, enabled: true },
      });
      return this.toPreference(update.type, stored);
    });
  }

  private toPreference(
    type: string,
    stored: { type: string; channel: string; enabled: boolean }[],
  ): NotificationPreference {
    const mine: Partial<Record<NotificationChannel, boolean>> = {};
    for (const row of stored) {
      if (row.type === type && isNotificationChannel(row.channel)) mine[row.channel] = row.enabled;
    }
    return { type, channels: resolveChannels(type, mine) };
  }
}
