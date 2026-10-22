import { type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp } from '../src/app.factory.js';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG } from '../src/config/config.module.js';
import { parseEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { DatabaseSafetyService } from '../src/infrastructure/tenancy/database-safety.service.js';

export function testEnv(overrides: Record<string, string | undefined> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://intime_app:pass@localhost:5432/intime_test',
    SYSTEM_DATABASE_URL: 'postgresql://intime_system:pass@localhost:5432/intime_test',
    WEB_APP_URL: 'http://localhost:5173',
    JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    MAIL_TRANSPORT: 'memory',
    // Undefined overrides keep the default (e.g. when TEST_DATABASE_URL is not set).
    ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)),
  });
}

interface CreateTestAppOptions {
  env?: Env;
  /** Replaces the real database client; omit to use a real PrismaService. */
  prisma?: Partial<Record<keyof PrismaService, unknown>>;
  controllers?: Type[];
  /** Replaces any provider by its injection token, e.g. the Google client. */
  providers?: { provide: unknown; useValue: unknown }[];
}

export async function createTestApp({
  env = testEnv(),
  prisma,
  controllers = [],
  providers = [],
}: CreateTestAppOptions = {}): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule], controllers })
    .overrideProvider(APP_CONFIG)
    .useValue(env);
  for (const override of providers) {
    builder = builder.overrideProvider(override.provide as Type).useValue(override.useValue);
  }
  if (prisma) {
    builder = builder
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(DatabaseSafetyService)
      .useValue({ onApplicationBootstrap: async () => {} });
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, env);
  await app.init();
  return app;
}
