import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiErrorBodySchema } from '@intime/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mapException } from '../src/common/errors/map-exception.js';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { createTestApp, testEnv } from './helpers.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('database integration', () => {
  let prisma: PrismaService;

  beforeAll(() => {
    prisma = new PrismaService(testEnv({ DATABASE_URL: databaseUrl }));
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.tenant.deleteMany();
  });

  it('creates a tenant with sensible defaults and a UUID id', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Acme', slug: 'acme' } });
    expect(tenant.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(tenant).toMatchObject({ defaultLocale: 'en', defaultTimezone: 'Europe/Sofia' });
    expect(tenant.createdAt).toBeInstanceOf(Date);
  });

  it('rejects a duplicate slug and maps it to CONFLICT', async () => {
    await prisma.tenant.create({ data: { name: 'Acme', slug: 'acme' } });
    const error = await prisma.tenant
      .create({ data: { name: 'Other', slug: 'acme' } })
      .catch((e: unknown) => e);
    const mapped = mapException(error);
    expect(mapped).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(JSON.stringify(mapped)).not.toContain('tenant_slug_key');
  });

  it('maps updating a missing row to NOT_FOUND', async () => {
    const error = await prisma.tenant
      .update({ where: { slug: 'ghost' }, data: { name: 'x' } })
      .catch((e: unknown) => e);
    expect(mapException(error).code).toBe('NOT_FOUND');
  });

  describe('readiness with a real database', () => {
    let app: NestExpressApplication | undefined;
    afterAll(async () => {
      await app?.close();
    });

    it('is ready when the database is reachable', async () => {
      app = await createTestApp({ env: testEnv({ DATABASE_URL: databaseUrl }) });
      const res = await request(app.getHttpServer()).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.checks.database).toBe('up');
      await app.close();
      app = undefined;
    });

    it('returns 503 when the database is unreachable', async () => {
      app = await createTestApp({
        env: testEnv({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/none' }),
      });
      const res = await request(app.getHttpServer()).get('/health/ready');
      expect(res.status).toBe(503);
      expect(apiErrorBodySchema.parse(res.body).error.code).toBe('SERVICE_UNAVAILABLE');
    });
  });
});
