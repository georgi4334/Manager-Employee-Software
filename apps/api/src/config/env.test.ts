import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://intime_app:pass@localhost:5432/intime',
  SYSTEM_DATABASE_URL: 'postgresql://intime_system:pass@localhost:5432/intime',
  WEB_APP_URL: 'https://app.intime.example',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};
const production = { ...valid, NODE_ENV: 'production', MAIL_TRANSPORT: 'disabled' };

describe('parseEnv', () => {
  it('applies defaults for optional values', () => {
    const env = parseEnv(valid);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: [],
      SWAGGER_ENABLED: true,
      IS_PRODUCTION: false,
    });
  });

  it('coerces PORT from a string and accepts postgres:// URLs', () => {
    const env = parseEnv({ ...valid, DATABASE_URL: 'postgres://u:p@h/db', PORT: '8080' });
    expect(env.PORT).toBe(8080);
  });

  it('splits and trims CORS origins', () => {
    const env = parseEnv({
      ...valid,
      CORS_ORIGINS: ' http://localhost:5173 , https://app.example.com ,',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('turns Swagger off by default in production but allows an explicit override', () => {
    expect(parseEnv(production)).toMatchObject({
      SWAGGER_ENABLED: false,
      IS_PRODUCTION: true,
    });
    expect(parseEnv({ ...production, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(true);
    expect(parseEnv({ ...valid, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(false);
  });

  it('applies auth defaults and derives values', () => {
    const env = parseEnv({ ...valid, WEB_APP_URL: 'https://app.intime.example/path/' });
    expect(env).toMatchObject({
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 14,
      SESSION_MAX_DAYS: 30,
      MAIL_TRANSPORT: 'log',
      COOKIE_SECURE: false,
      WEB_APP_ORIGIN: 'https://app.intime.example',
      GOOGLE: null,
    });
    expect(parseEnv(production).COOKIE_SECURE).toBe(true);
    expect(parseEnv({ ...production, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
  });

  it('enables Google only when all three settings are present', () => {
    const google = {
      GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REDIRECT_URL: 'https://api.intime.example/api/v1/auth/google/callback',
    };
    expect(parseEnv({ ...valid, ...google }).GOOGLE).toEqual({
      clientId: google.GOOGLE_CLIENT_ID,
      clientSecret: 'secret',
      redirectUrl: google.GOOGLE_REDIRECT_URL,
    });
    expect(() => parseEnv({ ...valid, GOOGLE_CLIENT_ID: 'only-the-id' })).toThrow(
      /GOOGLE_CLIENT_ID/,
    );
  });

  it('refuses mail transports that would leak links or drop mail silently in production', () => {
    expect(() => parseEnv({ ...production, MAIL_TRANSPORT: 'log' })).toThrow(/MAIL_TRANSPORT/);
    expect(() => parseEnv({ ...production, MAIL_TRANSPORT: 'memory' })).toThrow(/MAIL_TRANSPORT/);
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/MAIL_TRANSPORT/);
    expect(parseEnv(production).MAIL_TRANSPORT).toBe('disabled');
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() => parseEnv({})).toThrow(EnvValidationError);
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it.each([
    ['a non-postgres URL', { ...valid, DATABASE_URL: 'mysql://u:p@h/db' }],
    ['garbage', { ...valid, DATABASE_URL: 'not a url' }],
    ['a missing SYSTEM_DATABASE_URL', { DATABASE_URL: valid.DATABASE_URL }],
    ['a non-postgres SYSTEM_DATABASE_URL', { ...valid, SYSTEM_DATABASE_URL: 'http://x' }],
    ['an out-of-range PORT', { ...valid, PORT: '70000' }],
    ['a non-numeric PORT', { ...valid, PORT: 'abc' }],
    ['an unknown NODE_ENV', { ...valid, NODE_ENV: 'staging' }],
    ['an invalid LOG_LEVEL', { ...valid, LOG_LEVEL: 'loud' }],
    ['an invalid CORS origin', { ...valid, CORS_ORIGINS: 'localhost:5173,not-a-url' }],
    ['a non-boolean SWAGGER_ENABLED', { ...valid, SWAGGER_ENABLED: 'yes' }],
    ['a short JWT secret', { ...valid, JWT_ACCESS_SECRET: 'too-short' }],
    ['a missing JWT secret', { ...valid, JWT_ACCESS_SECRET: undefined }],
    ['a missing WEB_APP_URL', { ...valid, WEB_APP_URL: undefined }],
    ['a non-http WEB_APP_URL', { ...valid, WEB_APP_URL: 'ftp://x.example' }],
    ['an access-token TTL above one hour', { ...valid, ACCESS_TOKEN_TTL_SECONDS: '7200' }],
    ['an unknown mail transport', { ...valid, MAIL_TRANSPORT: 'smtp' }],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseEnv(raw)).toThrow(EnvValidationError);
  });

  it('lists every problem in one readable error without echoing secret values', () => {
    try {
      parseEnv({
        ...valid,
        DATABASE_URL: 'mysql://user:supersecret@h/db',
        PORT: 'abc',
        JWT_ACCESS_SECRET: 'jwtsecret',
      });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('PORT');
      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).not.toContain('supersecret');
      expect(message).not.toContain('jwtsecret');
    }
  });
});
