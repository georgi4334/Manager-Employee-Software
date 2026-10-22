import { Logger } from '@nestjs/common';
import type { Mailer } from './mailer.js';

/** Drops emails. The warning deliberately contains no recipient or content (personal data, links). */
export class DisabledMailer implements Mailer {
  private readonly logger = new Logger('Mail');

  async send(): Promise<void> {
    this.logger.warn('Email not sent: MAIL_TRANSPORT=disabled');
  }
}
