import { execSync } from 'node:child_process';
import pg from 'pg';
import { APP_ROLE, SYSTEM_ROLE } from './db-urls.js';

/**
 * Prepares the integration-test database when TEST_DATABASE_URL (a role that can create roles and run
 * migrations) is set: login-enabled runtime roles, all migrations, and a probe table for RLS tests.
 */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    // In CI a missing database must fail loudly instead of silently skipping the integration tests.
    if (process.env.CI) throw new Error('TEST_DATABASE_URL must be set in CI');
    console.warn('[api tests] TEST_DATABASE_URL not set: database integration tests are skipped.');
    return;
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const role of [APP_ROLE, SYSTEM_ROLE]) {
      await client.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS;
        END IF; END $$`);
      await client.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD '${role}'`);
    }

    execSync('pnpm exec prisma migrate deploy', {
      env: { ...process.env, MIGRATION_DATABASE_URL: url },
      stdio: 'inherit',
    });

    // A tenant-scoped table that exists only in the test database, created exactly the way real
    // feature tables will be, so the RLS behaviour can be tested before any feature table exists.
    await client.query(`DO $$ BEGIN
      IF to_regclass('public.rls_probe') IS NULL THEN
        CREATE TABLE public.rls_probe (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL DEFAULT public.app_current_tenant()
            REFERENCES public.tenant(id) ON DELETE CASCADE,
          note text NOT NULL
        );
        PERFORM public.enable_tenant_rls('public.rls_probe');
      END IF; END $$`);
  } finally {
    await client.end();
  }
}
