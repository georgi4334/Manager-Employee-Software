import { Body, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiErrorBodySchema } from '@intime/contracts';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Public } from '../src/common/auth/decorators.js';
import { AppException } from '../src/common/errors/app-exception.js';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe.js';
import { TenantContext } from '../src/infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../src/infrastructure/tenancy/tenant-db.service.js';
import { createTestApp, testEnv } from './helpers.js';

const TENANT = '0192f5a0-0000-7000-8000-00000000000a';

@Public()
@Controller('test')
class TestController {
  constructor(
    private readonly tenantContext: TenantContext,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get('tenant')
  async tenant() {
    const before = this.tenantContext.getTenantId() ?? null;
    // Simulates authentication setting the tenant, then async work later in the same request.
    this.tenantContext.setTenantId(TENANT);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { before, after: this.tenantContext.getTenantId() };
  }

  @Get('tenant-data')
  tenantData() {
    return this.tenantDb.tx(async () => 'should never run');
  }

  @Get('app-error')
  appError(): never {
    throw new AppException('CONFLICT', { message: 'Email taken', params: { field: 'email' } });
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException('nope');
  }

  @Get('boom')
  boom(): never {
    throw new Error('secret connection string postgres://admin:hunter2@db');
  }

  @Post('validate')
  validate(@Body(new ZodValidationPipe(z.object({ email: z.email() }))) body: { email: string }) {
    return body;
  }
}

const dbUp = { $queryRaw: vi.fn().mockResolvedValue([1]), $disconnect: vi.fn() };
let app: NestExpressApplication | undefined;

async function start(options: Parameters<typeof createTestApp>[0] = {}) {
  app = await createTestApp({ prisma: dbUp, controllers: [TestController], ...options });
  return request(app.getHttpServer());
}

afterEach(async () => {
  await app?.close();
  app = undefined;
  dbUp.$queryRaw.mockResolvedValue([1]);
});

describe('health', () => {
  it('GET /health/live is ok without touching the database', async () => {
    const http = await start();
    dbUp.$queryRaw.mockClear();
    const res = await http.get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(dbUp.$queryRaw).not.toHaveBeenCalled();
  });

  it('GET /health/ready is ok when the database answers', async () => {
    const res = await (await start()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up' } });
  });

  it('GET /health/ready returns 503 in the standard error format when the database is down', async () => {
    dbUp.$queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await (await start()).get('/health/ready');
    expect(res.status).toBe(503);
    expect(apiErrorBodySchema.parse(res.body).error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('health routes are not under the /api/v1 prefix', async () => {
    const res = await (await start()).get('/api/v1/health/live');
    expect(res.status).toBe(404);
  });
});

describe('error format', () => {
  it('returns AppException as the documented body', async () => {
    const res = await (await start()).get('/api/v1/test/app-error');
    expect(res.status).toBe(409);
    expect(apiErrorBodySchema.parse(res.body).error).toMatchObject({
      code: 'CONFLICT',
      message: 'Email taken',
      status: 409,
      params: { field: 'email' },
    });
  });

  it('maps Nest HttpExceptions', async () => {
    const res = await (await start()).get('/api/v1/test/forbidden');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 NOT_FOUND for unknown routes', async () => {
    const res = await (await start()).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(apiErrorBodySchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_FAILED with details for invalid bodies', async () => {
    const res = await (await start()).post('/api/v1/test/validate').send({ email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details[0].path).toBe('email');
  });

  it('accepts a valid body', async () => {
    const res = await (await start()).post('/api/v1/test/validate').send({ email: 'a@b.co' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ email: 'a@b.co' });
  });

  it('returns 400 BAD_REQUEST for malformed JSON', async () => {
    const res = await (
      await start()
    )
      .post('/api/v1/test/validate')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(apiErrorBodySchema.parse(res.body).error.code).toBe('BAD_REQUEST');
  });

  it('returns 413 PAYLOAD_TOO_LARGE for oversized bodies', async () => {
    const res = await (
      await start()
    )
      .post('/api/v1/test/validate')
      .send({ email: 'a@b.co', filler: 'x'.repeat(300_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('hides internal details of unexpected errors', async () => {
    const res = await (await start()).get('/api/v1/test/boom');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});

describe('request id', () => {
  it('generates an id, returns it in the header and in error bodies', async () => {
    const res = await (await start()).get('/api/v1/does-not-exist');
    const id = res.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.error.requestId).toBe(id);
  });

  it('keeps a well-formed incoming id', async () => {
    const res = await (
      await start()
    )
      .get('/api/v1/does-not-exist')
      .set('x-request-id', 'abc-12345678');
    expect(res.headers['x-request-id']).toBe('abc-12345678');
  });

  it.each(['short', 'has spaces and !!', 'x'.repeat(100)])(
    'replaces a malformed incoming id %#',
    async (bad) => {
      const res = await (await start()).get('/api/v1/does-not-exist').set('x-request-id', bad);
      expect(res.headers['x-request-id']).not.toBe(bad);
    },
  );
});

describe('tenant context per request', () => {
  it('starts every request without a tenant and keeps the one set by auth for the whole request', async () => {
    const http = await start();
    const first = await http.get('/api/v1/test/tenant');
    expect(first.body).toEqual({ before: null, after: TENANT });
    // The next request must not inherit the previous request's tenant.
    const second = await http.get('/api/v1/test/tenant');
    expect(second.body).toEqual({ before: null, after: TENANT });
  });

  it('fails closed with a generic 500 when tenant data is accessed without a tenant', async () => {
    const res = await (await start()).get('/api/v1/test/tenant-data');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });
});

describe('http hardening', () => {
  it('sets security headers and hides the framework', async () => {
    const res = await (await start()).get('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows configured CORS origins only', async () => {
    const http = await start({ env: testEnv({ CORS_ORIGINS: 'http://localhost:5173' }) });
    const allowed = await http.get('/health/live').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await http.get('/health/live').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sends no CORS headers when no origins are configured', async () => {
    const res = await (await start()).get('/health/live').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('OpenAPI docs', () => {
  it('serves the OpenAPI document when enabled', async () => {
    const res = await (await start()).get('/api/docs-json');
    expect(res.status).toBe(200);
    expect(res.body.info.title).toBe('InTime API');
    expect(Object.keys(res.body.paths)).toContain('/health/live');
  });

  it('is not served when disabled (production default)', async () => {
    const http = await start({
      env: testEnv({ NODE_ENV: 'production', MAIL_TRANSPORT: 'disabled' }),
    });
    expect((await http.get('/api/docs-json')).status).toBe(404);
    expect((await http.get('/api/docs')).status).toBe(404);
  });
});
