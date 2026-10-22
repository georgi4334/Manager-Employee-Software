import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_STATUS, apiErrorBodySchema, isErrorCode } from './errors.js';

describe('error codes', () => {
  it('has an HTTP status for every code', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(ERROR_STATUS[code]).toBeLessThan(600);
    }
  });

  it.each(ERROR_CODES)('recognises %s', (code) => {
    expect(isErrorCode(code)).toBe(true);
  });

  it.each(['NOPE', 'not_found', '', null, 404])('rejects %p', (value) => {
    expect(isErrorCode(value)).toBe(false);
  });
});

describe('apiErrorBodySchema', () => {
  const valid = {
    error: { code: 'NOT_FOUND', message: 'x', status: 404, requestId: 'abc' },
  };

  it('accepts a minimal valid body', () => {
    expect(apiErrorBodySchema.safeParse(valid).success).toBe(true);
  });

  it('accepts details and params', () => {
    const body = {
      error: {
        ...valid.error,
        code: 'VALIDATION_FAILED',
        details: [{ path: 'email', code: 'invalid_format', message: 'Invalid email' }],
        params: { max: 5 },
      },
    };
    expect(apiErrorBodySchema.safeParse(body).success).toBe(true);
  });

  it('rejects unknown codes and missing fields', () => {
    expect(
      apiErrorBodySchema.safeParse({ error: { ...valid.error, code: 'SOMETHING' } }).success,
    ).toBe(false);
    expect(apiErrorBodySchema.safeParse({ error: { code: 'NOT_FOUND' } }).success).toBe(false);
    expect(apiErrorBodySchema.safeParse({}).success).toBe(false);
  });
});
