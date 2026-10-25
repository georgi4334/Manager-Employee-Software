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

    /** Base URL of the web app: used for links in emails, redirects after Google sign-in, and CSRF checks. */
    WEB_APP_URL: z.url({ protocol: /^https?$/, message: 'must be an http(s) URL' }),
    /** Signs access tokens. Generate with: openssl rand -base64 48 */
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    /**
     * Trust the X-Forwarded-For header of one proxy hop (the hosting platform's load balancer), so rate
     * limits see the real client IP. Defaults to on in production.
     */
    TRUST_PROXY: booleanString.optional(),
    /** Proxy hops in front of the API whose X-Forwarded-For entries are trusted (see docs/adr/0005). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),
    /** Background delivery of notifications and emails. Turn off for tests and one-off commands. */
    WORKER_ENABLED: booleanString.default(true),
    /**
     * Shared secret of the reminder hook (POST /api/v1/internal/reminders/run) for an external scheduler. Without it
     * the hook does not exist. At least 32 characters; generate: openssl rand -base64 48
     */
    REMINDERS_TOKEN: z.string().min(32).optional(),
    /** Secure cookies (HTTPS only). Defaults to on in production. */
    COOKIE_SECURE: booleanString.optional(),
    /**
     * "log" prints emails including their links (development only), "memory" keeps them (tests),
     * "disabled" drops them with a content-free warning, "resend" delivers through Resend (production).
     */
    MAIL_TRANSPORT: z.enum(['log', 'memory', 'disabled', 'resend']).default('log'),
    RESEND_API_KEY: z.string().min(1).optional(),
    /** Sender shown to recipients, on a domain verified with the provider, e.g. "InTime <no-reply@example.eu>". */
    MAIL_FROM: z.string().min(3).optional(),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_REDIRECT_URL: z.url().optional(),
  })
  .superRefine((env, ctx) => {
    const google = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URL];
    if (google.some(Boolean) && !google.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message:
          'set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URL together, or none',
      });
    }
    if (env.MAIL_TRANSPORT === 'resend') {
      for (const key of ['RESEND_API_KEY', 'MAIL_FROM'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'is required when MAIL_TRANSPORT=resend',
          });
        }
      }
    }
    // "log" would write one-time sign-in links into production logs.
    if (
      env.NODE_ENV === 'production' &&
      (env.MAIL_TRANSPORT === 'log' || env.MAIL_TRANSPORT === 'memory')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message: 'must not be "log" or "memory" in production',
      });
    }
  })
  .transform((env) => ({
    ...env,
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
    IS_PRODUCTION: env.NODE_ENV === 'production',
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    TRUST_PROXY: env.TRUST_PROXY ?? env.NODE_ENV === 'production',
    WEB_APP_ORIGIN: new URL(env.WEB_APP_URL).origin,
    GOOGLE:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URL
        ? {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUrl: env.GOOGLE_REDIRECT_URL,
          }
        : null,
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
