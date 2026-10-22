import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/, message: 'must be a postgres:// URL' });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    /** Runtime connection as intime_app: RLS limits it to the current tenant (docs/adr/0001). */
    DATABASE_URL: postgresUrl,
    /** Connection as intime_system for the few cross-tenant operations (provisioning, login, jobs). */
    SYSTEM_DATABASE_URL: postgresUrl,
    /** Comma-separated list of allowed browser origins, e.g. "http://localhost:5173". Empty = CORS off. */
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url({ message: 'must be a valid origin URL' }))),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Interactive OpenAPI docs at /api/docs. Defaults to on, except in production. */
    SWAGGER_ENABLED: booleanString.optional(),
  })
  .transform((env) => ({
    ...env,
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
    IS_PRODUCTION: env.NODE_ENV === 'production',
  }));

export type Env = z.output<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

/** Validates raw environment variables and returns a typed config; throws a readable error. */
export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;
  throw new EnvValidationError(
    result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  );
}
