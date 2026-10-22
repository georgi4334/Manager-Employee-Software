import { Logger } from '@nestjs/common';
import type { MailMessage, Mailer } from './mailer.js';

/**
 * Development only: prints emails (including their one-time links) to the console. Configuration
 * refuses this transport in production, so links never end up in production logs.
 */
export class LogMailer implements Mailer {
  private readonly logger = new Logger('Mail');

  async send(message: MailMessage): Promise<void> {
    this.logger.log(`\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`);
  }
}
