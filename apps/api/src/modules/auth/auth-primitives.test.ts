import { describe, expect, it } from 'vitest';
import { testEnv } from '../../../test/helpers.js';
import { AccessTokenService } from './access-token.service.js';
import { chooseCandidate } from './auth.service.js';
import { pkceChallenge, randomToken, sha256 } from './crypto.js';
import { LoginAttemptLimiter } from './login-attempt-limiter.js';
import { PasswordService } from './password.service.js';

const A = '0192f5a0-0000-7000-8000-00000000000a';
const B = '0192f5a0-0000-7000-8000-00000000000b';
const S = '0192f5a0-0000-7000-8000-00000000000c';

describe('crypto helpers', () => {
  it('creates unique 43-character url-safe tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, randomToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes deterministically without exposing the input', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toBe(sha256('abd'));
    expect(sha256('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computes the RFC 7636 PKCE S256 challenge', () => {
    // Test vector from RFC 7636, appendix B.
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('hashes with argon2id and verifies the right password only', async () => {
    const hash = await passwords.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await passwords.verify(hash, 'correct horse battery staple')).toBe(true);
    expect(await passwords.verify(hash, 'correct horse battery stapler')).toBe(false);
  });

  it('salts: the same password gives different hashes', async () => {
    expect(await passwords.hash('same password here')).not.toBe(
      await passwords.hash('same password here'),
    );
  });

  it('treats a corrupted hash as a failed check instead of crashing', async () => {
    expect(await passwords.verify('not-a-hash', 'whatever')).toBe(false);
  });

  it('runs the dummy check without throwing', async () => {
    await expect(passwords.verifyDummy('anything')).resolves.toBeUndefined();
  });
});

describe('AccessTokenService', () => {
  const service = new AccessTokenService(testEnv());
  const claims = { userId: A, tenantId: B, sessionId: S };

  it('round-trips the claims', async () => {
    expect(await service.verify(await service.sign(claims))).toEqual(claims);
  });

  it('expires after the configured TTL (900 s)', async () => {
    const issued = new Date('2026-10-22T10:00:00Z');
    const token = await service.sign(claims, issued);
    expect(await service.verify(token, new Date('2026-10-22T10:14:00Z'))).toEqual(claims);
    expect(await service.verify(token, new Date('2026-10-22T10:16:00Z'))).toBeNull();
  });

  it('rejects tokens signed with another secret', async () => {
    const other = new AccessTokenService(
      testEnv({ JWT_ACCESS_SECRET: 'another-secret-that-is-32-chars-long!!' }),
    );
    expect(await service.verify(await other.sign(claims))).toBeNull();
  });

  it('rejects tampered tokens', async () => {
    const token = await service.sign(claims);
    const [header, payload, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        sub: A,
        tid: A,
        sid: S,
        iss: 'intime-api',
        aud: 'intime-web',
        exp: 9_999_999_999,
      }),
    ).toString('base64url');
    expect(await service.verify(`${header}.${forged}.${signature}`)).toBeNull();
    expect(await service.verify(`${header}.${payload}.${signature}x`)).toBeNull();
  });

  it('rejects the "none" algorithm and garbage', async () => {
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: A, tid: B, sid: S })).toString('base64url')}.`;
    expect(await service.verify(none)).toBeNull();
    expect(await service.verify('')).toBeNull();
    expect(await service.verify('a.b.c')).toBeNull();
  });

  it('rejects valid signatures with non-UUID claims', async () => {
    const token = await service.sign({ ...claims, tenantId: 'not-a-uuid' });
    expect(await service.verify(token)).toBeNull();
  });
});

describe('LoginAttemptLimiter', () => {
  it('blocks an email after 10 failures for 15 minutes, then forgets', () => {
    let now = 0;
    const limiter = new LoginAttemptLimiter(() => now);
    for (let i = 0; i < 9; i++) limiter.recordFailure('a@b.co');
    expect(limiter.isBlocked('a@b.co')).toBe(false);
    limiter.recordFailure('a@b.co');
    expect(limiter.isBlocked('a@b.co')).toBe(true);
    expect(limiter.isBlocked('other@b.co')).toBe(false);
    now += 15 * 60 * 1000;
    expect(limiter.isBlocked('a@b.co')).toBe(false);
  });

  it('resets after a successful sign-in', () => {
    const limiter = new LoginAttemptLimiter();
    for (let i = 0; i < 10; i++) limiter.recordFailure('a@b.co');
    limiter.reset('a@b.co');
    expect(limiter.isBlocked('a@b.co')).toBe(false);
  });
});

describe('chooseCandidate', () => {
  const candidate = (slug: string, status = 'active') => ({
    id: A,
    tenantId: B,
    status,
    tenant: { slug, name: slug.toUpperCase() },
  });

  it('returns the single active match', () => {
    expect(chooseCandidate([candidate('acme')]).tenant.slug).toBe('acme');
  });

  it('rejects no match as invalid credentials', () => {
    expect(() => chooseCandidate([])).toThrow(
      expect.objectContaining({ code: 'INVALID_CREDENTIALS' }),
    );
  });

  it('asks to pick a workspace when several match, listing only those', () => {
    expect(() => chooseCandidate([candidate('acme'), candidate('beta')])).toThrow(
      expect.objectContaining({
        code: 'TENANT_SELECTION_REQUIRED',
        params: {
          workspaces: [
            { slug: 'acme', name: 'ACME' },
            { slug: 'beta', name: 'BETA' },
          ],
        },
      }),
    );
  });

  it('reports a disabled account', () => {
    expect(() => chooseCandidate([candidate('acme', 'disabled')])).toThrow(
      expect.objectContaining({ code: 'ACCOUNT_DISABLED' }),
    );
  });
});
