import { execSync } from 'node:child_process';

/** Applies migrations to the integration-test database when TEST_DATABASE_URL is set. */
export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    // In CI a missing database must fail loudly instead of silently skipping the integration tests.
    if (process.env.CI) throw new Error('TEST_DATABASE_URL must be set in CI');
    console.warn('[api tests] TEST_DATABASE_URL not set: database integration tests are skipped.');
    return;
  }
  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
