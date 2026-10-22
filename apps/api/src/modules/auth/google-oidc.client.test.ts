import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GoogleOidcClient, GoogleOidcError } from './google-oidc.client.js';

const config = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'secret',
  redirectUrl: 'https://api.example/api/v1/auth/google/callback',
};

let privateKey: CryptoKey;
let client: GoogleOidcClient;

async function idToken(
  overrides: Record<string, unknown> = {},
  options: { audience?: string; issuer?: string; expired?: boolean; key?: CryptoKey } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: 'Maria@Example.com',
    email_verified: true,
    nonce: 'nonce-1',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject('google-sub-1')
    .setIssuer(options.issuer ?? 'https://accounts.google.com')
    .setAudience(options.audience ?? config.clientId)
    .setIssuedAt(now - 60)
    .setExpirationTime(options.expired ? now - 10 : now + 300)
    .sign(options.key ?? privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  client = new GoogleOidcClient(config, createLocalJWKSet({ keys: [jwk] }));
});

describe('GoogleOidcClient.authorizationUrl', () => {
  it('builds a PKCE code-flow URL with state, nonce and minimal scopes', () => {
    const url = new URL(client.authorizationUrl({ state: 's', nonce: 'n', codeChallenge: 'c' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: config.clientId,
      redirect_uri: config.redirectUrl,
      response_type: 'code',
      scope: 'openid email',
      state: 's',
      nonce: 'n',
      code_challenge: 'c',
      code_challenge_method: 'S256',
    });
  });
});

describe('GoogleOidcClient.verifyIdToken', () => {
  it('accepts a valid token and returns subject, email and verification flag', async () => {
    expect(await client.verifyIdToken(await idToken(), 'nonce-1')).toEqual({
      subject: 'google-sub-1',
      email: 'Maria@Example.com',
      emailVerified: true,
    });
  });

  it('reports an unverified email (the caller refuses it)', async () => {
    const identity = await client.verifyIdToken(
      await idToken({ email_verified: false }),
      'nonce-1',
    );
    expect(identity.emailVerified).toBe(false);
  });

  it.each([
    ['a wrong nonce (replay)', () => idToken({ nonce: 'other' })],
    ['another app as audience', () => idToken({}, { audience: 'someone-else' })],
    ['a foreign issuer', () => idToken({}, { issuer: 'https://evil.example' })],
    ['an expired token', () => idToken({}, { expired: true })],
    ['a token without email', () => idToken({ email: undefined })],
  ])('rejects %s', async (_label, make) => {
    await expect(client.verifyIdToken(await make(), 'nonce-1')).rejects.toBeInstanceOf(
      GoogleOidcError,
    );
  });

  it('rejects a token signed by another key', async () => {
    const other = await generateKeyPair('RS256');
    await expect(
      client.verifyIdToken(await idToken({}, { key: other.privateKey }), 'nonce-1'),
    ).rejects.toBeInstanceOf(GoogleOidcError);
  });
});

describe('GoogleOidcClient.exchangeCode', () => {
  it('posts the code with the PKCE verifier and returns the id_token', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ id_token: 'tok' }), { status: 200 }),
    );
    const withFetch = new GoogleOidcClient(
      config,
      createLocalJWKSet({ keys: [] }),
      fetchFn as unknown as typeof fetch,
    );
    expect(await withFetch.exchangeCode('code-1', 'verifier-1')).toBe('tok');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(Object.fromEntries(body)).toMatchObject({
      code: 'code-1',
      code_verifier: 'verifier-1',
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUrl,
    });
  });

  it.each([
    ['an error status', new Response('{}', { status: 400 })],
    ['a body without id_token', new Response('{}', { status: 200 })],
  ])('fails on %s', async (_label, response) => {
    const withFetch = new GoogleOidcClient(
      config,
      createLocalJWKSet({ keys: [] }),
      (async () => response) as unknown as typeof fetch,
    );
    await expect(withFetch.exchangeCode('c', 'v')).rejects.toBeInstanceOf(GoogleOidcError);
  });
});
