import { Inject, Injectable, Logger } from '@nestjs/common';
import { isNotificationType } from '@intime/contracts';
import { APP_CONFIG } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.js';
import { MAILER, type Mailer } from '../../../infrastructure/mail/mailer.js';
import { resolveEmailLocale } from '../../../infrastructure/mail/templates.js';
import { SystemPrismaService } from '../../../infrastructure/prisma/system-prisma.service.js';
import { renderNotificationEmail } from '../email-templates.js';
import { MAX_ATTEMPTS, backoffMs } from './notification-processor.service.js';

const LEASE_MS = 5 * 60 * 1000;

interface ClaimedEmail {
  id: string;
  tenantId: string;
  recipientUserId: string;
  type: string;
  attempts: number;
}

export type EmailOutcome = 'sent' | 'retry' | 'failed' | 'skipped';

/**
 * Sends the emails of notifications whose recipient wants them. Email goes out AFTER the database work is
 * committed, so delivery is at-least-once: a crash between sending and recording can send twice.
 */
@Injectable()
export class EmailDispatcher {
  private readonly logger = new Logger(EmailDispatcher.name);

  constructor(
    @Inject(APP_CONFIG) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly system: SystemPrismaService,
  ) {}

  claim(limit: number, now: Date): Promise<ClaimedEmail[]> {
    const leaseEnd = new Date(now.getTime() + LEASE_MS);
    return this.system.$queryRaw<ClaimedEmail[]>`
      UPDATE notification
         SET email_status = 'sending', email_attempts = email_attempts + 1, email_next_at = ${leaseEnd}
       WHERE id IN (
         SELECT id FROM notification
          WHERE (email_status = 'pending' AND email_next_at <= ${now})
             OR (email_status = 'sending' AND email_next_at < ${now})
          ORDER BY created_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
      RETURNING id, tenant_id AS "tenantId", recipient_user_id AS "recipientUserId", type, email_attempts AS attempts`;
  }

  async send(item: ClaimedEmail, now: Date): Promise<EmailOutcome> {
    try {
      const recipient = await this.system.user.findFirst({
        where: { id: item.recipientUserId, tenantId: item.tenantId },
        select: {
          email: true,
          status: true,
          locale: true,
          tenant: { select: { name: true, defaultLocale: true } },
        },
      });
      // Only active people get email: invited accounts have not set up yet, disabled ones have left.
      if (!recipient || recipient.status !== 'active' || !isNotificationType(item.type)) {
        await this.finish(item.id, { emailStatus: 'skipped', emailNextAt: null });
        return 'skipped';
      }

      const email = renderNotificationEmail(
        item.type,
        resolveEmailLocale(recipient.locale, recipient.tenant.defaultLocale),
        {
          workspace: recipient.tenant.name,
          link: `${this.env.WEB_APP_URL.replace(/\/$/, '')}${await this.linkOf(item.id)}`,
        },
      );
      await this.mailer.send({ to: recipient.email, ...email });
      await this.finish(item.id, { emailStatus: 'sent', emailSentAt: now, emailNextAt: null });
      return 'sent';
    } catch (error) {
      return this.fail(item, error, now);
    }
  }

  private async linkOf(notificationId: string): Promise<string> {
    const row = await this.system.notification.findUniqueOrThrow({
      where: { id: notificationId },
      select: { link: true },
    });
    return row.link;
  }

  private finish(
    id: string,
    data: { emailStatus: string; emailNextAt: Date | null; emailSentAt?: Date },
  ) {
    return this.system.notification.update({ where: { id }, data });
  }

  private async fail(item: ClaimedEmail, error: unknown, now: Date): Promise<EmailOutcome> {
    const failed = item.attempts >= MAX_ATTEMPTS;
    // Only ids in the log: recipient addresses are personal data.
    this.logger.warn(
      {
        notificationId: item.id,
        attempts: item.attempts,
        failed,
        err: error instanceof Error ? error.name : 'error',
      },
      'Email delivery failed',
    );
    try {
      await this.finish(
        item.id,
        failed
          ? { emailStatus: 'failed', emailNextAt: null }
          : {
              emailStatus: 'pending',
              emailNextAt: new Date(now.getTime() + backoffMs(item.attempts)),
            },
      );
    } catch (updateError) {
      this.logger.error(
        { err: updateError, notificationId: item.id },
        'Could not record email failure',
      );
    }
    return failed ? 'failed' : 'retry';
  }
}
