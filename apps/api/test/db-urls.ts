/** Connection strings for the integration-test database, one per role (docs/adr/0001-multi-tenancy-rls.md). */
export const APP_ROLE = 'intime_app';
export const SYSTEM_ROLE = 'intime_system';

export function roleUrl(base: string, role: string): string {
  const url = new URL(base);
  url.username = role;
  // Test-only password, set by global-setup. Real environments use secrets.
  url.password = role;
  return url.toString();
}

export function testDbUrls(): { owner: string; app: string; system: string } | undefined {
  const owner = process.env.TEST_DATABASE_URL;
  if (!owner) return undefined;
  return { owner, app: roleUrl(owner, APP_ROLE), system: roleUrl(owner, SYSTEM_ROLE) };
}
