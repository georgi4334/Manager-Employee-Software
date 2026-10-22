import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Connects as intime_system, which RLS lets see every tenant. Only for provisioning, login lookup and
 * background jobs; ESLint restricts where it may be imported (docs/adr/0001-multi-tenancy-rls.md).
 */
@Injectable()
export class SystemPrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: Env) {
    super({ adapter: new PrismaPg({ connectionString: config.SYSTEM_DATABASE_URL }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
