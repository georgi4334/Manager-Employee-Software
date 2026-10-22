import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://intime_app:pass@localhost:5432/intime',
  SYSTEM_DATABASE_URL: 'postgresql://intime_system:pass@localhost:5432/intime',
};

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
    expect(parseEnv({ ...valid, NODE_ENV: 'production' })).toMatchObject({
      SWAGGER_ENABLED: false,
      IS_PRODUCTION: true,
    });
    expect(
      parseEnv({ ...valid, NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED,
    ).toBe(true);
    expect(parseEnv({ ...valid, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(false);
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
  ])('rejects %s', (_label, raw) => {
    expect(() => parseEnv(raw)).toThrow(EnvValidationError);
  });

  it('lists every problem in one readable error without echoing secret values', () => {
    try {
      parseEnv({ ...valid, DATABASE_URL: 'mysql://user:supersecret@h/db', PORT: 'abc' });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('PORT');
      expect(message).not.toContain('supersecret');
    }
  });
});
