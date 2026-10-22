import { describe, expect, it } from 'vitest';
import {
  acceptInvitationRequestSchema,
  emailSchema,
  loginRequestSchema,
  normalizeEmail,
  passwordProblems,
  passwordSchema,
  tokenSchema,
  workspaceSlugSchema,
} from './auth.js';

const TOKEN = 'a'.repeat(43);

describe('emailSchema', () => {
  it('trims and lower-cases', () => {
    expect(emailSchema.parse('  Maria.Ivanova@Example.COM ')).toBe('maria.ivanova@example.com');
    expect(normalizeEmail(' A@B.CO ')).toBe('a@b.co');
  });

  it.each(['', 'nope', 'a@', '@b.co', 'a b@c.de', `${'x'.repeat(250)}@b.co`])(
    'rejects %p',
    (value) => {
      expect(emailSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('workspaceSlugSchema', () => {
  it.each(['acme', 'acme-gmbh', 'a1', 'ACME'])('accepts %s', (value) => {
    expect(workspaceSlugSchema.safeParse(value).success).toBe(true);
  });

  it.each(['', '-acme', 'acme-', 'ac me', 'acme_gmbh', 'x'.repeat(64), "'; drop"])(
    'rejects %p',
    (value) => {
      expect(workspaceSlugSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('passwordSchema and passwordProblems', () => {
  it('accepts 12 to 128 characters', () => {
    expect(passwordSchema.safeParse('x'.repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse('x'.repeat(128)).success).toBe(true);
  });

  it('rejects shorter than 12 and longer than 128', () => {
    expect(passwordSchema.safeParse('x'.repeat(11)).success).toBe(false);
    expect(passwordSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });

  it('flags passwords containing the email name', () => {
    expect(passwordProblems('MyMaria2026!!', 'maria@example.com')).toContain(
      'password_contains_email',
    );
  });

  it('flags very repetitive passwords', () => {
    expect(passwordProblems('aaaaaaaaaaaa', 'x@y.zz')).toContain('password_too_repetitive');
    expect(passwordProblems('abababababab', 'x@y.zz')).toContain('password_too_repetitive');
  });

  it('accepts a reasonable passphrase', () => {
    expect(passwordProblems('correct horse battery staple', 'maria@example.com')).toEqual([]);
  });

  it('ignores very short email names (would block too much)', () => {
    expect(passwordProblems('my jo password 1', 'jo@example.com')).toEqual([]);
  });
});

describe('request schemas', () => {
  it('parses a login request and normalizes email and workspace', () => {
    expect(
      loginRequestSchema.parse({ email: ' A@B.CO', password: 'x', workspace: 'ACME' }),
    ).toEqual({ email: 'a@b.co', password: 'x', workspace: 'acme' });
  });

  it('rejects an empty or oversized login password', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
    expect(
      loginRequestSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(129) }).success,
    ).toBe(false);
  });

  it('accepts only well-formed one-time tokens', () => {
    expect(tokenSchema.safeParse(TOKEN).success).toBe(true);
    expect(tokenSchema.safeParse('a'.repeat(42)).success).toBe(false);
    expect(tokenSchema.safeParse(`${'a'.repeat(42)}=`).success).toBe(false);
  });

  it('requires a policy-compliant password to accept an invitation', () => {
    expect(
      acceptInvitationRequestSchema.safeParse({ token: TOKEN, password: 'short' }).success,
    ).toBe(false);
    expect(
      acceptInvitationRequestSchema.safeParse({ token: TOKEN, password: 'long enough password' })
        .success,
    ).toBe(true);
  });
});
