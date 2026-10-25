import { timingSafeEqual } from 'node:crypto';
import { Controller, Headers, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { APP_CONFIG } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { Public } from '../../common/auth/decorators.js';
import { AppException } from '../../common/errors/app-exception.js';
import { OutboxWorker } from './delivery/outbox-worker.service.js';
import { RemindersService, type ReminderStats } from './delivery/reminders.service.js';

const safeEqual = (given: string, expected: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** The hook for an external scheduler (docs/adr/0017-integrations.md): there is no user, only a shared secret. */
@ApiTags('internal')
@Controller('internal')
export class RemindersController {
  constructor(
    @Inject(APP_CONFIG) private readonly env: Env,
    private readonly reminders: RemindersService,
    private readonly worker: OutboxWorker,
  ) {}

  @Post('reminders/run')
  @HttpCode(200)
  @Public()
  @ApiOperation({ summary: 'Send due reminders (needs the REMINDERS_TOKEN as a bearer token)' })
  async run(@Headers('authorization') authorization?: string): Promise<ReminderStats> {
    const expected = this.env.REMINDERS_TOKEN;
    // Without a token the hook does not exist.
    if (!expected) throw new AppException('NOT_FOUND', { message: 'Not found' });
    const given = /^Bearer (.+)$/.exec(authorization ?? '')?.[1] ?? '';
    if (!safeEqual(given, expected)) {
      throw new AppException('UNAUTHENTICATED', { message: 'Authentication required' });
    }
    const stats = await this.reminders.run();
    // The events just queued are delivered now, not at the next sweep.
    this.worker.wake();
    return stats;
  }
}
