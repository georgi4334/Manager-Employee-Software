import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './redirect';

describe('safeRedirectPath', () => {
  it.each(['/', '/leave', '/employees?page=2', '/organization/teams/5#top'])(
    'keeps the internal path %s',
    (path) => {
      expect(safeRedirectPath(path)).toBe(path);
    },
  );

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'leave',
    '',
    null,
    undefined,
    42,
    { path: '/x' },
    `/${'a'.repeat(3000)}`,
  ])('falls back to "/" for %p (no open redirect)', (value) => {
    expect(safeRedirectPath(value)).toBe('/');
  });

  it.each([
    '/login',
    '/login?error=X',
    '/forgot-password',
    '/reset-password?token=a',
    '/accept-invitation',
  ])('never redirects back into the sign-in pages (%s)', (path) => {
    expect(safeRedirectPath(path)).toBe('/');
  });

  it('uses the given fallback', () => {
    expect(safeRedirectPath('//x', '/home')).toBe('/home');
  });
});
