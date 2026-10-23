import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DisabledMailer } from './disabled.mailer.js';
import { LogMailer } from './log.mailer.js';
import { MAILER, type Mailer } from './mailer.js';
import { MemoryMailer } from './memory.mailer.js';
import { ResendMailer } from './resend.mailer.js';

@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (env: Env): Mailer => {
        if (env.MAIL_TRANSPORT === 'memory') return new MemoryMailer();
        if (env.MAIL_TRANSPORT === 'disabled') return new DisabledMailer();
        // The env schema guarantees both values for this transport.
        if (env.MAIL_TRANSPORT === 'resend')
          return new ResendMailer(env.RESEND_API_KEY!, env.MAIL_FROM!);
        return new LogMailer();
      },
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
