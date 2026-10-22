import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { AppException } from '../common/errors/app-exception.js';
import { parseEnv } from '../config/env.js';
import { TenantProvisioningService } from '../modules/tenants/tenant-provisioning.service.js';

const USAGE =
  'Usage: pnpm --filter @intime/api tenant:create --name "Acme GmbH" --slug acme --admin-email admin@acme.eu [--locale de] [--timezone Europe/Berlin]';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      slug: { type: 'string' },
      'admin-email': { type: 'string' },
      locale: { type: 'string' },
      timezone: { type: 'string' },
    },
  });
  if (!values.name || !values.slug || !values['admin-email']) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  parseEnv(process.env);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const result = await app.get(TenantProvisioningService).create({
      name: values.name,
      slug: values.slug,
      adminEmail: values['admin-email'],
      locale: values.locale as 'en' | 'de' | 'bg' | undefined,
      timezone: values.timezone,
    });
    console.log(`Workspace created: ${values.slug} (${result.tenantId})`);
    console.log(`Send this invitation link to the admin (valid 7 days):\n${result.invitationLink}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof AppException) {
    console.error(`${error.code}: ${error.message}`, error.details ?? error.params ?? '');
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
