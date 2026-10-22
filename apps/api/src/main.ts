import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { configureApp } from './app.factory.js';
import { AppModule } from './app.module.js';
import { APP_CONFIG } from './config/config.module.js';
import { parseEnv, type Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  // Fail fast with a readable message (no Nest stack trace) when configuration is invalid.
  parseEnv(process.env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const env = app.get<Env>(APP_CONFIG);
  configureApp(app, env);

  await app.listen(env.PORT, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
