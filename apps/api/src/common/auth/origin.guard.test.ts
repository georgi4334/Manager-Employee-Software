import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { testEnv } from '../../../test/helpers.js';
import { OriginGuard } from './origin.guard.js';

const guard = new OriginGuard(testEnv({ CORS_ORIGINS: 'https://admin.intime.example' }));
const contextFor = (method: string, origin?: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ method, headers: origin ? { origin } : {} }) }),
  }) as unknown as ExecutionContext;

describe('OriginGuard', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('lets safe method %s through from any origin', (method) => {
    expect(guard.canActivate(contextFor(method, 'https://evil.example'))).toBe(true);
  });

  it('allows writes from the web app and configured origins', () => {
    expect(guard.canActivate(contextFor('POST', 'http://localhost:5173'))).toBe(true);
    expect(guard.canActivate(contextFor('DELETE', 'https://admin.intime.example'))).toBe(true);
  });

  it('allows writes without an Origin header (not a browser cross-site request)', () => {
    expect(guard.canActivate(contextFor('POST'))).toBe(true);
  });

  it.each([
    'https://evil.example',
    'http://localhost:5174',
    'null',
    'http://localhost:5173.evil.example',
  ])('rejects writes from %s', (origin) => {
    expect(() => guard.canActivate(contextFor('POST', origin))).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });
});
