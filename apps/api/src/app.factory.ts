import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { Env } from './config/env.js';
import { TenantContext } from './infrastructure/tenancy/tenant-context.js';

export const API_PREFIX = 'api/v1';
const UNPREFIXED_ROUTES = ['health/live', 'health/ready'];

/** Shared by main.ts and the e2e tests so tests exercise the real HTTP setup. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  // The interactive docs page needs inline scripts; the API itself only serves JSON.
  app.use(helmet({ contentSecurityPolicy: env.SWAGGER_ENABLED ? false : undefined }));
  if (env.IS_PRODUCTION) app.set('trust proxy', 1);

  // Every request gets its own tenant context; authentication sets the tenant inside it.
  const tenantContext = app.get(TenantContext);
  app.use((_req: unknown, _res: unknown, next: () => void) => tenantContext.runEmpty(next));

  app.setGlobalPrefix(API_PREFIX, { exclude: UNPREFIXED_ROUTES });

  if (env.CORS_ORIGINS.length > 0) {
    app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  }

  if (env.SWAGGER_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle('InTime API')
      .setDescription('Employee management API')
      .setVersion('0.1.0')
      .build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config));
  }

  app.enableShutdownHooks();
}
