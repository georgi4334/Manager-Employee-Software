import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiErrorBodySchema } from '@intime/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAILER } from '../src/infrastructure/mail/mailer.js';
import type { MemoryMailer } from '../src/infrastructure/mail/memory.mailer.js';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { AccessTokenService } from '../src/modules/auth/access-token.service.js';
import {
  GOOGLE_OIDC,
  GoogleOidcError,
  type AuthorizationParams,
  type GoogleIdentity,
} from '../src/modules/auth/google-oidc.client.js';
import { TenantProvisioningService } from '../src/modules/tenants/tenant-provisioning.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';

const urls = testDbUrls();
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a completely different passphrase';

type Res = request.Response;

/** Parses Set-Cookie headers into name -> { value, attributes }. */
function cookies(res: Res): Record<string, { value: string; attrs: string }> {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const result: Record<string, { value: string; attrs: string }> = {};
  for (const line of header ?? []) {
    const [pair = '', ...attrs] = line.split(';');
    const index = pair.indexOf('=');
    result[pair.slice(0, index)] = {
      value: pair.slice(index + 1),
      attrs: attrs.join(';').toLowerCase(),
    };
  }
  return result;
}

const errorCode = (res: Res) => apiErrorBodySchema.parse(res.body).error.code;
const tokenFrom = (link: string) => new URL(link).searchParams.get('token') ?? '';

class FakeGoogle {
  identity: GoogleIdentity = {
    subject: 'google-sub-1',
    email: 'maria@acme.eu',
    emailVerified: true,
  };
  private nonce?: string;

  authorizationUrl(params: AuthorizationParams): string {
    this.nonce = params.nonce;
    return `https://accounts.google.com/o/oauth2/v2/auth?state=${params.state}`;
  }

  async exchangeCode(code: string): Promise<string> {
    if (code !== 'good-code') throw new GoogleOidcError('bad code');
    return 'id-token';
  }

  async verifyIdToken(_idToken: string, nonce: string): Promise<GoogleIdentity> {
    if (nonce !== this.nonce) throw new GoogleOidcError('nonce mismatch');
    return this.identity;
  }
}

describe.skipIf(!urls)('authentication (HTTP, real database)', () => {
  const env = testEnv({
    DATABASE_URL: urls?.app,
    SYSTEM_DATABASE_URL: urls?.system,
    TRUST_PROXY: 'true',
  });
  const google = new FakeGoogle();
  let app: NestExpressApplication;
  let system: SystemPrismaService;
  let mailer: MemoryMailer;
  let provisioning: TenantProvisioningService;

  let testNumber = 0;
  const agent = () =>
    request
      .agent(app.getHttpServer())
      .set('X-Forwarded-For', `10.1.${Math.floor(testNumber / 250)}.${testNumber % 250}`);
  const http = agent;

  async function workspace(
    slug: string,
    adminEmail = 'maria@acme.eu',
    locale: 'en' | 'de' | 'bg' = 'en',
  ) {
    const result = await provisioning.create({ name: `${slug} GmbH`, slug, adminEmail, locale });
    return { ...result, token: tokenFrom(result.invitationLink) };
  }

  /** Creates a workspace whose admin has accepted the invitation; returns a signed-in agent. */
  async function activeUser(slug: string, email = 'maria@acme.eu', password = PASSWORD) {
    const ws = await workspace(slug, email);
    const signedIn = agent();
    const res = await signedIn
      .post('/api/v1/auth/invitations/accept')
      .send({ token: ws.token, password });
    expect(res.status).toBe(200);
    return { ...ws, agent: signedIn, res };
  }

  beforeAll(async () => {
    app = await createTestApp({ env, providers: [{ provide: GOOGLE_OIDC, useValue: google }] });
    system = app.get(SystemPrismaService);
    mailer = app.get(MAILER);
    provisioning = app.get(TenantProvisioningService);
  });

  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  beforeEach(async () => {
    await system.tenant.deleteMany();
    mailer.clear();
    // One app serves every test; a fresh client IP per test keeps rate-limit counters apart.
    testNumber += 1;
    google.identity = { subject: 'google-sub-1', email: 'maria@acme.eu', emailVerified: true };
  });

  describe('workspace provisioning', () => {
    it('creates a workspace and emails a localized invitation to the first admin', async () => {
      const ws = await workspace('acme', 'Maria@ACME.eu', 'de');
      expect(ws.invitationLink).toMatch(
        /^http:\/\/localhost:5173\/accept-invitation\?token=[\w-]{43}$/,
      );
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]).toMatchObject({
        to: 'maria@acme.eu',
        subject: 'Einladung zu acme GmbH auf InTime',
      });
      expect(mailer.sent[0]?.text).toContain(ws.invitationLink);
      const user = await system.user.findFirstOrThrow({ where: { tenantId: ws.tenantId } });
      expect(user).toMatchObject({ email: 'maria@acme.eu', status: 'invited' });
    });

    it('rejects a taken slug and invalid input', async () => {
      await workspace('acme');
      await expect(
        provisioning.create({ name: 'Other', slug: 'acme', adminEmail: 'x@y.eu' }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      await expect(
        provisioning.create({ name: 'Other', slug: 'Bad Slug', adminEmail: 'nope' }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });

    it('stores only a hash of the invitation token', async () => {
      const ws = await workspace('acme');
      const stored = await system.authToken.findFirstOrThrow({ where: { tenantId: ws.tenantId } });
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.tokenHash).not.toContain(ws.token);
    });
  });

  describe('invitations', () => {
    it('shows who and which workspace an invitation is for', async () => {
      const ws = await workspace('acme');
      const res = await http().post('/api/v1/auth/invitations/inspect').send({ token: ws.token });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        email: 'maria@acme.eu',
        workspace: { slug: 'acme', name: 'acme GmbH' },
      });
    });

    it('rejects unknown and malformed tokens', async () => {
      const unknown = await http()
        .post('/api/v1/auth/invitations/inspect')
        .send({ token: 'a'.repeat(43) });
      expect([unknown.status, errorCode(unknown)]).toEqual([400, 'TOKEN_INVALID']);
      const malformed = await http()
        .post('/api/v1/auth/invitations/inspect')
        .send({ token: 'short' });
      expect([malformed.status, errorCode(malformed)]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('accepting sets the password, activates the user and signs in with secure cookies', async () => {
      const { res, agent: signedIn } = await activeUser('acme');
      expect(res.body).toMatchObject({ email: 'maria@acme.eu', workspace: { slug: 'acme' } });

      const set = cookies(res);
      expect(set.intime_at?.attrs).toContain('httponly');
      expect(set.intime_at?.attrs).toContain('samesite=lax');
      expect(set.intime_at?.attrs).toContain('path=/api');
      expect(set.intime_rt?.attrs).toContain('httponly');
      expect(set.intime_rt?.attrs).toContain('path=/api/v1/auth');

      const me = await signedIn.get('/api/v1/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.email).toBe('maria@acme.eu');
      expect(JSON.stringify(me.body)).not.toMatch(/password|hash/i);
    });

    it('works only once', async () => {
      const ws = await workspace('acme');
      await http()
        .post('/api/v1/auth/invitations/accept')
        .send({ token: ws.token, password: PASSWORD });
      const again = await http()
        .post('/api/v1/auth/invitations/accept')
        .send({ token: ws.token, password: PASSWORD });
      expect([again.status, errorCode(again)]).toEqual([400, 'TOKEN_INVALID']);
    });

    it('works only once even when used twice at the same moment', async () => {
      const ws = await workspace('acme');
      const results = await Promise.all(
        [PASSWORD, NEW_PASSWORD].map((password) =>
          http().post('/api/v1/auth/invitations/accept').send({ token: ws.token, password }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
      expect(await system.authIdentity.count({ where: { provider: 'password' } })).toBe(1);
    });

    it('rejects weak passwords and keeps the invitation usable', async () => {
      const ws = await workspace('acme');
      const short = await http()
        .post('/api/v1/auth/invitations/accept')
        .send({ token: ws.token, password: 'short' });
      expect(errorCode(short)).toBe('VALIDATION_FAILED');
      const withName = await http()
        .post('/api/v1/auth/invitations/accept')
        .send({ token: ws.token, password: 'maria is the best 2026' });
      expect(errorCode(withName)).toBe('VALIDATION_FAILED');
      expect(withName.body.error.details[0].code).toBe('password_contains_email');

      const ok = await http()
        .post('/api/v1/auth/invitations/accept')
        .send({ token: ws.token, password: PASSWORD });
      expect(ok.status).toBe(200);
    });

    it('rejects an expired invitation', async () => {
      const ws = await workspace('acme');
      await system.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      const res = await http()
        .post('/api/v1/auth/invitations/accept')
        .send({ token: ws.token, password: PASSWORD });
      expect(errorCode(res)).toBe('TOKEN_INVALID');
    });

    it('re-inviting replaces the old link; inviting an active user is a conflict', async () => {
      const ws = await workspace('acme');
      const invitations = app.get(TenantProvisioningService);
      expect(invitations).toBeDefined();
      const { InvitationService } = await import('../src/modules/auth/invitation.service.js');
      const { TenantDb } = await import('../src/infrastructure/tenancy/tenant-db.service.js');
      const { TenantContext } = await import('../src/infrastructure/tenancy/tenant-context.js');
      const invite = (email: string) =>
        app
          .get(TenantContext)
          .run(ws.tenantId, () =>
            app.get(TenantDb).tx((tx) => app.get(InvitationService).invite(tx, email)),
          );

      const second = await invite('maria@acme.eu');
      const old = await http().post('/api/v1/auth/invitations/inspect').send({ token: ws.token });
      expect(errorCode(old)).toBe('TOKEN_INVALID');
      const accepted = await http()
        .post('/api/v1/auth/invitations/accept')
        .send({ token: tokenFrom(second.link), password: PASSWORD });
      expect(accepted.status).toBe(200);

      await expect(invite('MARIA@acme.eu')).rejects.toMatchObject({
        code: 'CONFLICT',
        params: { field: 'email' },
      });
    });
  });

  describe('login', () => {
    it('signs in with the right password (email is case-insensitive)', async () => {
      await activeUser('acme');
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: ' Maria@ACME.eu ', password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.workspace.slug).toBe('acme');
      expect(Object.keys(cookies(res))).toEqual(expect.arrayContaining(['intime_at', 'intime_rt']));
    });

    it('gives the same answer for a wrong password, an unknown email and a not-yet-accepted invitation', async () => {
      await activeUser('acme');
      await workspace('beta', 'invited@beta.eu');
      const attempts = [
        { email: 'maria@acme.eu', password: 'wrong password!!' },
        { email: 'nobody@acme.eu', password: PASSWORD },
        { email: 'invited@beta.eu', password: PASSWORD },
      ];
      for (const body of attempts) {
        const res = await http().post('/api/v1/auth/login').send(body);
        expect(res.status).toBe(401);
        expect(res.body.error).toMatchObject({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
        expect(cookies(res).intime_at).toBeUndefined();
      }
    });

    it('tells a disabled user only after the right password', async () => {
      await activeUser('acme');
      await system.user.updateMany({ data: { status: 'disabled' } });
      const right = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'maria@acme.eu', password: PASSWORD });
      expect([right.status, errorCode(right)]).toEqual([403, 'ACCOUNT_DISABLED']);
      const wrong = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'maria@acme.eu', password: 'wrong password!!' });
      expect(errorCode(wrong)).toBe('INVALID_CREDENTIALS');
    });

    it('asks which workspace when the same credentials work in several, and signs into the chosen one', async () => {
      await activeUser('acme');
      await activeUser('beta');
      const ambiguous = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'maria@acme.eu', password: PASSWORD });
      expect([ambiguous.status, errorCode(ambiguous)]).toEqual([409, 'TENANT_SELECTION_REQUIRED']);
      expect(ambiguous.body.error.params.workspaces).toEqual([
        { slug: 'acme', name: 'acme GmbH' },
        { slug: 'beta', name: 'beta GmbH' },
      ]);
      expect(cookies(ambiguous).intime_at).toBeUndefined();

      const chosen = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'maria@acme.eu', password: PASSWORD, workspace: 'beta' });
      expect([chosen.status, chosen.body.workspace.slug]).toEqual([200, 'beta']);
    });

    it('does not reveal other workspaces to someone who only knows one password', async () => {
      await activeUser('acme', 'maria@acme.eu', PASSWORD);
      await activeUser('beta', 'maria@acme.eu', NEW_PASSWORD);
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'maria@acme.eu', password: PASSWORD });
      expect([res.status, res.body.workspace.slug]).toEqual([200, 'acme']);
    });

    it('blocks an email after 10 failed attempts, even with the right password', async () => {
      await activeUser('acme');
      const limited = await createTestApp({ env });
      try {
        for (let i = 0; i < 10; i++) {
          await request(limited.getHttpServer())
            .post('/api/v1/auth/login')
            .send({ email: 'maria@acme.eu', password: `wrong password ${i}` });
        }
        const res = await request(limited.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: 'maria@acme.eu', password: PASSWORD });
        expect([res.status, errorCode(res)]).toEqual([429, 'RATE_LIMITED']);
        expect(res.body.error.message).toBe('Too many failed sign-ins, try again later');

        // Other people (same IP, e.g. one office) can still sign in.
        const colleague = await request(limited.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: 'nobody@acme.eu', password: PASSWORD });
        expect(colleague.status).toBe(401);
      } finally {
        await limited.close();
      }
    });

    it('rate-limits sign-in requests per IP (60 per minute)', async () => {
      const limited = await createTestApp({ env });
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 61; i++) {
          // Invalid bodies are cheap and still count: the limit applies before validation.
          statuses.push(
            (await request(limited.getHttpServer()).post('/api/v1/auth/login').send({})).status,
          );
        }
        expect(statuses.slice(0, 60).every((s) => s === 400)).toBe(true);
        expect(statuses[60]).toBe(429);
      } finally {
        await limited.close();
      }
    });

    it('rejects sign-in posted from a foreign website (CSRF)', async () => {
      await activeUser('acme');
      const res = await http()
        .post('/api/v1/auth/login')
        .set('Origin', 'https://evil.example')
        .send({ email: 'maria@acme.eu', password: PASSWORD });
      expect([res.status, errorCode(res)]).toEqual([403, 'FORBIDDEN']);
    });

    it('validates the request body', async () => {
      const res = await http().post('/api/v1/auth/login').send({ email: 'not-an-email' });
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
    });
  });

  describe('protected routes', () => {
    it('require a valid access token', async () => {
      expect((await http().get('/api/v1/auth/me')).status).toBe(401);
      const garbage = await http().get('/api/v1/auth/me').set('Cookie', 'intime_at=garbage');
      expect([garbage.status, errorCode(garbage)]).toEqual([401, 'UNAUTHENTICATED']);
    });

    it('stop working immediately when the user is disabled (no 15-minute wait)', async () => {
      const { agent: signedIn } = await activeUser('acme');
      expect((await signedIn.get('/api/v1/auth/me')).status).toBe(200);
      await system.user.updateMany({ data: { status: 'disabled' } });
      expect((await signedIn.get('/api/v1/auth/me')).status).toBe(401);
    });

    it('a correctly signed token pointing at another tenant finds no session (RLS)', async () => {
      const acme = await activeUser('acme');
      const beta = await activeUser('beta', 'ivan@beta.eu');
      const acmeSession = await system.session.findFirstOrThrow({
        where: { tenantId: acme.tenantId },
      });
      const forged = await app.get(AccessTokenService).sign({
        userId: acmeSession.userId,
        tenantId: beta.tenantId,
        sessionId: acmeSession.id,
      });
      const res = await http().get('/api/v1/auth/me').set('Cookie', `intime_at=${forged}`);
      expect(res.status).toBe(401);
    });

    it('each user only ever sees their own workspace', async () => {
      const acme = await activeUser('acme');
      const beta = await activeUser('beta', 'ivan@beta.eu');
      expect((await acme.agent.get('/api/v1/auth/me')).body.workspace.slug).toBe('acme');
      expect((await beta.agent.get('/api/v1/auth/me')).body.workspace.slug).toBe('beta');
    });
  });

  describe('refresh tokens', () => {
    const refresh = (refreshToken?: string) =>
      http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshToken ? `intime_rt=${refreshToken}` : '');

    it('rotate: each refresh issues new tokens', async () => {
      const { res } = await activeUser('acme');
      const first = cookies(res).intime_rt?.value ?? '';
      const rotated = await refresh(first);
      expect(rotated.status).toBe(204);
      const next = cookies(rotated);
      expect(next.intime_rt?.value).toMatch(/^[\w-]{43}$/);
      expect(next.intime_rt?.value).not.toBe(first);
      const me = await http()
        .get('/api/v1/auth/me')
        .set('Cookie', `intime_at=${next.intime_at?.value}`);
      expect(me.status).toBe(200);
    });

    it('a just-used token (second browser tab) is refused without ending the session', async () => {
      const { res } = await activeUser('acme');
      const first = cookies(res).intime_rt?.value ?? '';
      const next = cookies(await refresh(first)).intime_rt?.value ?? '';
      expect((await refresh(first)).status).toBe(401);
      expect((await refresh(next)).status).toBe(204);
    });

    it('an old token coming back ends the whole session (stolen token)', async () => {
      const { res } = await activeUser('acme');
      const first = cookies(res).intime_rt?.value ?? '';
      const next = cookies(await refresh(first)).intime_rt?.value ?? '';
      await system.refreshToken.updateMany({
        where: { usedAt: { not: null } },
        data: { usedAt: new Date(Date.now() - 60_000) },
      });
      expect((await refresh(first)).status).toBe(401);
      expect((await refresh(next)).status).toBe(401);
      expect((await system.session.findFirstOrThrow()).revokedAt).not.toBeNull();
    });

    it('refuses missing, malformed, unknown and expired tokens and clears the cookies', async () => {
      const { res } = await activeUser('acme');
      for (const token of [undefined, 'garbage', 'a'.repeat(43)]) {
        const attempt = await refresh(token);
        expect([attempt.status, errorCode(attempt)]).toEqual([401, 'UNAUTHENTICATED']);
        expect(cookies(attempt).intime_rt?.attrs).toContain('expires=thu, 01 jan 1970');
      }
      await system.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await refresh(cookies(res).intime_rt?.value)).status).toBe(401);
    });

    it('stop working when the session reaches its maximum age', async () => {
      const { res } = await activeUser('acme');
      await system.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await refresh(cookies(res).intime_rt?.value)).status).toBe(401);
    });
  });

  describe('logout', () => {
    it('ends the session: access and refresh stop working', async () => {
      const { agent: signedIn, res } = await activeUser('acme');
      const out = await signedIn.post('/api/v1/auth/logout');
      expect(out.status).toBe(204);
      expect(cookies(out).intime_at?.attrs).toContain('expires=thu, 01 jan 1970');

      const oldAccess = cookies(res).intime_at?.value;
      expect(
        (await http().get('/api/v1/auth/me').set('Cookie', `intime_at=${oldAccess}`)).status,
      ).toBe(401);
      const oldRefresh = cookies(res).intime_rt?.value;
      expect(
        (await http().post('/api/v1/auth/refresh').set('Cookie', `intime_rt=${oldRefresh}`)).status,
      ).toBe(401);
    });

    it('always succeeds, even without a session', async () => {
      expect((await http().post('/api/v1/auth/logout')).status).toBe(204);
    });
  });

  describe('password reset', () => {
    it('answers 202 for unknown emails without sending anything', async () => {
      const res = await http()
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'nobody@acme.eu' });
      expect(res.status).toBe(202);
      expect(mailer.sent).toHaveLength(0);
    });

    it('resets the password once and signs out every session', async () => {
      const { agent: signedIn } = await activeUser('acme');
      mailer.clear();
      expect(
        (await http().post('/api/v1/auth/password/forgot').send({ email: 'MARIA@acme.eu' })).status,
      ).toBe(202);
      expect(mailer.sent).toHaveLength(1);
      const link = mailer.sent[0]?.text.match(/https?:\/\/\S+/)?.[0] ?? '';
      expect(link).toContain('/reset-password?token=');

      const reset = await http()
        .post('/api/v1/auth/password/reset')
        .send({ token: tokenFrom(link), password: NEW_PASSWORD });
      expect(reset.status).toBe(204);
      expect((await signedIn.get('/api/v1/auth/me')).status).toBe(401);

      const oldLogin = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'maria@acme.eu', password: PASSWORD });
      expect(oldLogin.status).toBe(401);
      const newLogin = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'maria@acme.eu', password: NEW_PASSWORD });
      expect(newLogin.status).toBe(200);

      const again = await http()
        .post('/api/v1/auth/password/reset')
        .send({ token: tokenFrom(link), password: PASSWORD });
      expect(errorCode(again)).toBe('TOKEN_INVALID');
    });

    it('a reset link works only once even when used twice at the same moment', async () => {
      await activeUser('acme');
      await http().post('/api/v1/auth/password/forgot').send({ email: 'maria@acme.eu' });
      const token = tokenFrom(mailer.sent.at(-1)?.text.match(/https?:\/\/\S+/)?.[0] ?? '');
      const results = await Promise.all(
        ['first new passphrase!', 'second new passphrase'].map((password) =>
          http().post('/api/v1/auth/password/reset').send({ token, password }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
    });

    it('does not accept an invitation token as a reset token (or vice versa)', async () => {
      const ws = await workspace('acme');
      const res = await http()
        .post('/api/v1/auth/password/reset')
        .send({ token: ws.token, password: NEW_PASSWORD });
      expect(errorCode(res)).toBe('TOKEN_INVALID');
    });

    it('rejects an expired reset link', async () => {
      await activeUser('acme');
      await http().post('/api/v1/auth/password/forgot').send({ email: 'maria@acme.eu' });
      const link = mailer.sent.at(-1)?.text.match(/https?:\/\/\S+/)?.[0] ?? '';
      await system.authToken.updateMany({
        where: { purpose: 'password_reset' },
        data: { expiresAt: new Date(Date.now() - 1) },
      });
      const res = await http()
        .post('/api/v1/auth/password/reset')
        .send({ token: tokenFrom(link), password: NEW_PASSWORD });
      expect(errorCode(res)).toBe('TOKEN_INVALID');
    });
  });

  describe('Google sign-in', () => {
    async function googleSignIn(query = '', state?: string) {
      const browser = agent();
      const start = await browser.get(`/api/v1/auth/google/start${query}`);
      const location = new URL(start.headers.location ?? '');
      const callback = await browser.get(
        `/api/v1/auth/google/callback?code=good-code&state=${state ?? location.searchParams.get('state')}`,
      );
      return { start, callback, browser };
    }

    it('redirects to Google with a short-lived flow cookie', async () => {
      const { start } = await googleSignIn();
      expect(start.status).toBe(302);
      expect(start.headers.location).toMatch(/^https:\/\/accounts\.google\.com\//);
      expect(cookies(start).intime_g?.attrs).toContain('path=/api/v1/auth/google');
      expect(cookies(start).intime_g?.attrs).toContain('httponly');
    });

    it('signs in an existing user, links the Google account and returns to the web app', async () => {
      await activeUser('acme');
      const { callback, browser } = await googleSignIn();
      expect(callback.status).toBe(302);
      expect(callback.headers.location).toBe('http://localhost:5173/');
      expect((await browser.get('/api/v1/auth/me')).body.email).toBe('maria@acme.eu');
      const identity = await system.authIdentity.findFirst({ where: { provider: 'google' } });
      expect(identity?.providerSubject).toBe('google-sub-1');
      // Second time: same linked identity.
      expect((await googleSignIn()).callback.headers.location).toBe('http://localhost:5173/');
    });

    it.each([
      ['a state mismatch', () => googleSignIn('', 'forged-state'), 'INVALID_CREDENTIALS'],
      [
        'an unverified Google email',
        async () => {
          google.identity = { ...google.identity, emailVerified: false };
          return googleSignIn();
        },
        'INVALID_CREDENTIALS',
      ],
      [
        'an email without an InTime account',
        async () => {
          google.identity = { ...google.identity, email: 'stranger@gmail.com' };
          return googleSignIn();
        },
        'INVALID_CREDENTIALS',
      ],
      [
        'an account linked to another Google account',
        async () => {
          await system.authIdentity.create({
            data: {
              tenantId: (await system.tenant.findFirstOrThrow()).id,
              userId: (await system.user.findFirstOrThrow()).id,
              provider: 'google',
              providerSubject: 'someone-else',
            },
          });
          return googleSignIn();
        },
        'INVALID_CREDENTIALS',
      ],
      [
        'a disabled account',
        async () => {
          await system.user.updateMany({ data: { status: 'disabled' } });
          return googleSignIn();
        },
        'ACCOUNT_DISABLED',
      ],
    ])('refuses %s and redirects to the login page with the reason', async (_label, run, code) => {
      await activeUser('acme');
      const { callback, browser } = await run();
      expect(callback.status).toBe(302);
      expect(callback.headers.location).toBe(`http://localhost:5173/login?error=${code}`);
      expect(cookies(callback).intime_at).toBeUndefined();
      expect((await browser.get('/api/v1/auth/me')).status).toBe(401);
    });

    it('refuses a callback without the flow cookie (login CSRF)', async () => {
      await activeUser('acme');
      const res = await http().get('/api/v1/auth/google/callback?code=good-code&state=whatever');
      expect(res.headers.location).toBe('http://localhost:5173/login?error=INVALID_CREDENTIALS');
    });

    it('asks for a workspace when the Google email exists in several, and honours the choice', async () => {
      await activeUser('acme');
      await activeUser('beta');
      expect((await googleSignIn()).callback.headers.location).toBe(
        'http://localhost:5173/login?error=TENANT_SELECTION_REQUIRED',
      );
      const { callback, browser } = await googleSignIn('?workspace=beta');
      expect(callback.headers.location).toBe('http://localhost:5173/');
      expect((await browser.get('/api/v1/auth/me')).body.workspace.slug).toBe('beta');
    });

    it('is unavailable when Google is not configured', async () => {
      const withoutGoogle = await createTestApp({ env });
      try {
        expect(
          (await request(withoutGoogle.getHttpServer()).get('/api/v1/auth/google/start')).status,
        ).toBe(404);
      } finally {
        await withoutGoogle.close();
      }
    });
  });
});
