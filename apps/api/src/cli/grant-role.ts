import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { AppException } from '../common/errors/app-exception.js';
import { parseEnv } from '../config/env.js';
import { RoleGrantService } from '../modules/tenants/role-grant.service.js';

const USAGE =
  'Usage: pnpm --filter @intime/api roles:grant --workspace acme --email maria@acme.eu --role admin';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { workspace: { type: 'string' }, email: { type: 'string' }, role: { type: 'string' } },
  });
  if (!values.workspace || !values.email || !values.role) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  parseEnv(process.env);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const result = await app
      .get(RoleGrantService)
      .grant({ workspace: values.workspace, email: values.email, role: values.role });
    console.log(
      result.added
        ? `Granted ${result.roleKey} to ${values.email}.`
        : `${values.email} already has ${result.roleKey}.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof AppException
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : error,
  );
  process.exitCode = 1;
});
