import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppConfigModule, APP_CONFIG } from '../../config/config.module.js';
import { testEnv } from '../../../test/helpers.js';
import { DisabledMailer } from './disabled.mailer.js';
import { LogMailer } from './log.mailer.js';
import { MailModule } from './mail.module.js';
import { MAILER } from './mailer.js';
import { MemoryMailer } from './memory.mailer.js';
import { ResendMailer } from './resend.mailer.js';

async function mailerFor(transport: string) {
  const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, MailModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(testEnv({ MAIL_TRANSPORT: transport }))
    .compile();
  return moduleRef.get(MAILER);
}

describe('MailModule', () => {
  it.each([
    ['memory', MemoryMailer],
    ['log', LogMailer],
    ['disabled', DisabledMailer],
  ])('MAIL_TRANSPORT=%s uses the matching mailer', async (transport, type) => {
    expect(await mailerFor(transport)).toBeInstanceOf(type);
  });

  it('MAIL_TRANSPORT=resend uses the Resend mailer', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, MailModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(testEnv({ MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.eu' }))
      .compile();
    expect(moduleRef.get(MAILER)).toBeInstanceOf(ResendMailer);
  });
});
