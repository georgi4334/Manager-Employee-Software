import { Injectable, Logger } from '@nestjs/common';
import {
  NOTIFICATION_TYPES,
  isNotificationType,
  parseNotificationParams,
  resolveChannels,
  type NotificationChannel,
} from '@intime/contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import { SystemPrismaService } from '../../../infrastructure/prisma/system-prisma.service.js';
import { EVENT_DEFINITIONS, isEventType } from '../events.js';

export const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60 * 1000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;

export interface ClaimedEvent {
  id: string;
  tenantId: string;
  type: string;
  params: unknown;
  attempts: number;
}

export type ProcessOutcome = 'done' | 'retry' | 'dead';

/** A problem that retrying cannot fix (unknown event type, invalid parameters). */
class PermanentEventError extends Error {}

export const backoffMs = (attempts: number): number =>
  Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);

/**
 * Turns outbox events into notifications. Runs with the system database role because it works across
 * workspaces; every row it writes carries an explicit tenant id and the composite foreign keys guarantee the
 * recipient belongs to that same workspace.
 */
@Injectable()
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly system: SystemPrismaService) {}

  /**
   * Takes up to `limit` events that are due. `FOR UPDATE SKIP LOCKED` lets several workers share the queue;
   * the lease lets events of a crashed worker be taken again later.
   */
  claim(limit: number, now: Date): Promise<ClaimedEvent[]> {
    const leaseEnd = new Date(now.getTime() + LEASE_MS);
    return this.system.$queryRaw<ClaimedEvent[]>`
      UPDATE outbox_event
         SET status = 'processing', locked_until = ${leaseEnd}, attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM outbox_event
          WHERE (status = 'pending' AND available_at <= ${now})
             OR (status = 'processing' AND locked_until < ${now})
          ORDER BY created_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
      RETURNING id, tenant_id AS "tenantId", type, params, attempts`;
  }

  async process(event: ClaimedEvent, now: Date): Promise<ProcessOutcome> {
    try {
      if (event.attempts > MAX_ATTEMPTS) throw new PermanentEventError('Too many attempts');
      await this.deliver(event, now);
      return 'done';
    } catch (error) {
      return this.fail(event, error, now);
    }
  }

  private async deliver(event: ClaimedEvent, now: Date): Promise<void> {
    if (!isEventType(event.type)) throw new PermanentEventError(`Unknown event type ${event.type}`);
    const definition = EVENT_DEFINITIONS[event.type];
    const parsed = definition.params.safeParse(event.params);
    if (!parsed.success) throw new PermanentEventError('Invalid event parameters');
    // Typed through the definition of this exact event type.
    const intents = (
      definition.notify as (params: unknown) => ReturnType<typeof definition.notify>
    )(parsed.data);

    // Notifications and "event done" commit together: in-app delivery happens exactly once.
    await this.system.$transaction(async (tx) => {
      for (const intent of intents) {
        if (!isNotificationType(intent.type))
          throw new PermanentEventError(`Unknown notification type ${intent.type}`);
        let params: Record<string, unknown>;
        try {
          params = parseNotificationParams(intent.type, intent.params);
        } catch {
          throw new PermanentEventError('Invalid notification parameters');
        }

        const recipient = await tx.user.findFirst({
          where: { id: intent.recipientUserId, tenantId: event.tenantId },
          select: { id: true },
        });
        if (!recipient) continue; // The person no longer exists in this workspace: nobody to tell.

        const stored = await tx.notificationPreference.findMany({
          where: { userId: recipient.id, type: intent.type },
          select: { channel: true, enabled: true },
        });
        const preferences: Partial<Record<NotificationChannel, boolean>> = {};
        for (const row of stored) preferences[row.channel as NotificationChannel] = row.enabled;
        const channels = resolveChannels(intent.type, preferences);
        if (!channels.in_app.enabled && !channels.email.enabled) continue;

        await tx.notification.createMany({
          skipDuplicates: true, // Same event + same person: idempotent if processing is ever repeated.
          data: [
            {
              tenantId: event.tenantId,
              recipientUserId: recipient.id,
              eventId: event.id,
              type: intent.type,
              params: params as Prisma.InputJsonValue,
              link: NOTIFICATION_TYPES[intent.type].link,
              inApp: channels.in_app.enabled,
              emailStatus: channels.email.enabled ? 'pending' : 'none',
              emailNextAt: channels.email.enabled ? now : null,
            },
          ],
        });
      }
      await tx.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'done', processedAt: now, lockedUntil: null, lastError: null },
      });
    });
  }

  private async fail(event: ClaimedEvent, error: unknown, now: Date): Promise<ProcessOutcome> {
    const permanent = error instanceof PermanentEventError;
    const dead = permanent || event.attempts >= MAX_ATTEMPTS;
    // Never store anything but a short technical reason (no parameters, no personal data).
    const reason = (error instanceof Error ? error.message : 'Unknown error').slice(0, 300);
    this.logger.warn(
      { eventId: event.id, type: event.type, attempts: event.attempts, dead },
      'Outbox event failed',
    );
    try {
      await this.system.outboxEvent.update({
        where: { id: event.id },
        data: dead
          ? { status: 'dead', lockedUntil: null, lastError: reason }
          : {
              status: 'pending',
              lockedUntil: null,
              lastError: reason,
              availableAt: new Date(now.getTime() + backoffMs(event.attempts)),
            },
      });
    } catch (updateError) {
      // The lease will expire and the event will be claimed again.
      this.logger.error({ err: updateError, eventId: event.id }, 'Could not record outbox failure');
    }
    return dead ? 'dead' : 'retry';
  }
}
