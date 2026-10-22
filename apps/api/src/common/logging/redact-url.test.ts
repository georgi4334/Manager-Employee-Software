import { describe, expect, it } from 'vitest';
import { redactUrl } from './redact-url.js';

describe('redactUrl', () => {
  it('masks secret query parameters', () => {
    expect(redactUrl('/api/v1/auth/google/callback?code=4/abc&state=xyz')).toBe(
      '/api/v1/auth/google/callback?code=%5Bredacted%5D&state=%5Bredacted%5D',
    );
    expect(redactUrl('/x?TOKEN=secret&page=2')).toBe('/x?TOKEN=%5Bredacted%5D&page=2');
  });

  it('masks repeated parameters', () => {
    expect(redactUrl('/x?token=a&token=b')).not.toMatch(/=a|=b/);
  });

  it('leaves harmless URLs untouched', () => {
    expect(redactUrl('/api/v1/auth/me')).toBe('/api/v1/auth/me');
    expect(redactUrl('/api/v1/employees?page=2&sort=name')).toBe(
      '/api/v1/employees?page=2&sort=name',
    );
    expect(redactUrl('/api/v1/auth/google/start?workspace=acme')).toBe(
      '/api/v1/auth/google/start?workspace=acme',
    );
  });
});
