import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { parseEnv } from '../config/env.js';
import { RoleSyncService } from '../modules/tenants/role-sync.service.js';

/** Usage: pnpm --filter @intime/api roles:sync — run after every deploy that changes the permission catalog. */
async function main(): Promise<void> {
  parseEnv(process.env);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const results = await app.get(RoleSyncService).syncAll();
    for (const { slug, result } of results) {
      console.log(
        `${slug}: +${result.grantsAdded} added, ~${result.grantsChanged} changed, -${result.grantsRemoved} removed, ${result.rolesCreated} roles created`,
      );
    }
    console.log(`Synced system roles of ${results.length} workspace(s).`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
