import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  acceptInvitationRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
} from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  forgotFormSchema,
  loginFormSchema,
  passwordFormSchema,
  workspaceFieldSchema,
} from './forms';

const messages = (result: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) =>
  result.success ? [] : (result.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []);

describe('loginFormSchema', () => {
  it('accepts and normalizes valid input', () => {
    expect(loginFormSchema.parse({ email: '  Maria@ACME.eu ', password: 'x' })).toEqual({
      email: 'maria@acme.eu',
      password: 'x',
    });
  });

  it('reports empty fields as required', () => {
    expect(messages(loginFormSchema.safeParse({ email: '', password: '' })).sort()).toEqual([
      'email:required',
      'password:required',
    ]);
  });

  it.each(['nope', 'a@', '@b.co', 'a b@c.de'])('rejects the email %p', (email) => {
    expect(messages(loginFormSchema.safeParse({ email, password: 'x' }))).toEqual(['email:email']);
  });

  it('rejects an overlong email', () => {
    expect(
      messages(loginFormSchema.safeParse({ email: `${'x'.repeat(250)}@b.co`, password: 'x' })),
    ).toEqual(['email:tooLong']);
  });
});

describe('forgotFormSchema', () => {
  it('requires a valid email', () => {
    expect(forgotFormSchema.parse({ email: ' A@B.CO ' })).toEqual({ email: 'a@b.co' });
    expect(messages(forgotFormSchema.safeParse({ email: '' }))).toEqual(['email:required']);
    expect(messages(forgotFormSchema.safeParse({ email: 'x' }))).toEqual(['email:email']);
  });
});

describe('passwordFormSchema', () => {
  const schema = passwordFormSchema(() => 'maria@acme.eu');
  const ok = 'correct horse battery staple';

  it('accepts a good password that matches its confirmation', () => {
    expect(schema.safeParse({ password: ok, confirm: ok }).success).toBe(true);
  });

  it('requires both fields', () => {
    expect(messages(schema.safeParse({ password: '', confirm: '' })).sort()).toEqual([
      'confirm:required',
      'password:required',
    ]);
  });

  it('enforces the length limits at their exact boundaries', () => {
    const tooShort = 'x'.repeat(PASSWORD_MIN_LENGTH - 1);
    expect(messages(schema.safeParse({ password: tooShort, confirm: tooShort }))).toContain(
      'password:passwordMin',
    );
    const minimum = 'abcd'.repeat(PASSWORD_MIN_LENGTH / 4);
    expect(schema.safeParse({ password: minimum, confirm: minimum }).success).toBe(true);
    const tooLong = 'ab'.repeat(PASSWORD_MAX_LENGTH);
    expect(messages(schema.safeParse({ password: tooLong, confirm: tooLong }))).toContain(
      'password:passwordMax',
    );
  });

  it('reports a confirmation mismatch on the confirm field', () => {
    expect(messages(schema.safeParse({ password: ok, confirm: `${ok}!` }))).toEqual([
      'confirm:passwordsDontMatch',
    ]);
  });

  it('refuses passwords that contain the email name, as the API does', () => {
    const bad = 'my maria password 2026';
    expect(messages(schema.safeParse({ password: bad, confirm: bad }))).toEqual([
      'password:password_contains_email',
    ]);
  });

  it('refuses very repetitive passwords', () => {
    const bad = 'a'.repeat(PASSWORD_MIN_LENGTH);
    expect(messages(schema.safeParse({ password: bad, confirm: bad }))).toEqual([
      'password:password_too_repetitive',
    ]);
  });

  it('skips the email rule when the email is unknown (reset page; the API checks it)', () => {
    const noEmail = passwordFormSchema();
    const pw = 'my maria password 2026';
    expect(noEmail.safeParse({ password: pw, confirm: pw }).success).toBe(true);
  });
});

describe('workspaceFieldSchema', () => {
  it('normalizes and accepts slugs', () => {
    expect(workspaceFieldSchema.parse(' ACME-gmbh ')).toBe('acme-gmbh');
  });
  it.each(['', '-a', 'a-', 'a b', "a'; drop"])('rejects %p', (value) => {
    expect(workspaceFieldSchema.safeParse(value).success).toBe(false);
  });
});

describe('parity with the API schemas', () => {
  it('data accepted by the forms is accepted by the API', () => {
    const login = loginFormSchema.parse({ email: ' Maria@ACME.eu ', password: 'x' });
    expect(loginRequestSchema.safeParse(login).success).toBe(true);
    expect(
      forgotPasswordRequestSchema.safeParse(forgotFormSchema.parse({ email: 'A@B.CO' })).success,
    ).toBe(true);
    const password = 'correct horse battery staple';
    expect(
      acceptInvitationRequestSchema.safeParse({ token: 'a'.repeat(43), password }).success,
    ).toBe(true);
  });

  it('a password the form accepts always satisfies the API length rule', () => {
    for (const length of [PASSWORD_MIN_LENGTH, 40, PASSWORD_MAX_LENGTH]) {
      const password = 'abcdefgh'.repeat(20).slice(0, length);
      expect(passwordFormSchema().safeParse({ password, confirm: password }).success).toBe(true);
      expect(
        acceptInvitationRequestSchema.safeParse({ token: 'a'.repeat(43), password }).success,
      ).toBe(true);
    }
  });
});
