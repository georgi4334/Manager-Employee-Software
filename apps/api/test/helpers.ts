import { type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp } from '../src/app.factory.js';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG } from '../src/config/config.module.js';
import { parseEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';

export function testEnv(overrides: Record<string, string | undefined> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/intime_test',
    ...overrides,
  });
}

interface CreateTestAppOptions {
  env?: Env;
  /** Replaces the real database client; omit to use a real PrismaService. */
  prisma?: Partial<Record<keyof PrismaService, unknown>>;
  controllers?: Type[];
}

export async function createTestApp({
  env = testEnv(),
  prisma,
  controllers = [],
}: CreateTestAppOptions = {}): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule], controllers })
    .overrideProvider(APP_CONFIG)
    .useValue(env);
  if (prisma) builder = builder.overrideProvider(PrismaService).useValue(prisma);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, env);
  await app.init();
  return app;
}
