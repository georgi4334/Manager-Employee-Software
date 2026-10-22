import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiErrorBodySchema } from '@intime/contracts';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mapException } from '../src/common/errors/map-exception.js';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';

const urls = testDbUrls();

describe.skipIf(!urls)('database integration', () => {
  const env = testEnv({ DATABASE_URL: urls?.app, SYSTEM_DATABASE_URL: urls?.system });
  let system: SystemPrismaService;

  beforeAll(() => {
    system = new SystemPrismaService(env);
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await system.$disconnect();
  });
  beforeEach(async () => {
    await system.tenant.deleteMany();
  });

  it('creates a tenant with sensible defaults and a UUID id', async () => {
    const tenant = await system.tenant.create({ data: { name: 'Acme', slug: 'acme' } });
    expect(tenant.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(tenant).toMatchObject({ defaultLocale: 'en', defaultTimezone: 'Europe/Sofia' });
    expect(tenant.createdAt).toBeInstanceOf(Date);
  });

  it('rejects a duplicate slug and maps it to CONFLICT without internal details', async () => {
    await system.tenant.create({ data: { name: 'Acme', slug: 'acme' } });
    const error = await system.tenant
      .create({ data: { name: 'Other', slug: 'acme' } })
      .catch((e: unknown) => e);
    const mapped = mapException(error);
    expect(mapped).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(JSON.stringify(mapped)).not.toContain('tenant_slug_key');
  });

  it('maps updating a missing row to NOT_FOUND', async () => {
    const error = await system.tenant
      .update({ where: { slug: 'ghost' }, data: { name: 'x' } })
      .catch((e: unknown) => e);
    expect(mapException(error).code).toBe('NOT_FOUND');
  });

  describe('API startup and readiness with a real database', () => {
    let app: NestExpressApplication | undefined;
    afterEach(async () => {
      await app?.close();
      app = undefined;
    });

    it('starts and is ready when connected as intime_app', async () => {
      app = await createTestApp({ env });
      const res = await request(app.getHttpServer()).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.checks.database).toBe('up');
    });

    it('refuses to start when DATABASE_URL is the migration owner', async () => {
      await expect(
        createTestApp({
          env: testEnv({ DATABASE_URL: urls?.owner, SYSTEM_DATABASE_URL: urls?.system }),
        }),
      ).rejects.toThrow(/intime_app/);
    });

    it('starts but is not ready when the database is unreachable', async () => {
      app = await createTestApp({
        env: testEnv({
          DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/none',
          SYSTEM_DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/none',
        }),
      });
      const res = await request(app.getHttpServer()).get('/health/ready');
      expect(res.status).toBe(503);
      expect(apiErrorBodySchema.parse(res.body).error.code).toBe('SERVICE_UNAVAILABLE');
    });
  });
});
