import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
}

export interface GoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
}

export interface AuthorizationParams {
  state: string;
  nonce: string;
  codeChallenge: string;
}

export const GOOGLE_OIDC = Symbol('GOOGLE_OIDC');

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export class GoogleOidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleOidcError';
  }
}

/** Talks to Google: builds the consent URL, exchanges the code, verifies the signed ID token. */
export class GoogleOidcClient {
  constructor(
    private readonly config: GoogleConfig,
    private readonly keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(JWKS_URL)),
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  authorizationUrl({ state, nonce, codeChallenge }: AuthorizationParams): string {
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUrl,
      response_type: 'code',
      scope: 'openid email',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    const response = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        code_verifier: codeVerifier,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUrl,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new GoogleOidcError(`Token exchange failed with status ${response.status}`);
    const body = (await response.json()) as { id_token?: unknown };
    if (typeof body.id_token !== 'string')
      throw new GoogleOidcError('Token response has no id_token');
    return body.id_token;
  }

  /** Verifies signature, issuer, audience, expiry and nonce. */
  async verifyIdToken(idToken: string, expectedNonce: string): Promise<GoogleIdentity> {
    let payload;
    try {
      ({ payload } = await jwtVerify(idToken, this.keys, {
        issuer: ISSUERS,
        audience: this.config.clientId,
      }));
    } catch (error) {
      throw new GoogleOidcError(`Invalid ID token: ${(error as Error).message}`);
    }
    if (payload.nonce !== expectedNonce) throw new GoogleOidcError('ID token nonce mismatch');
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      throw new GoogleOidcError('ID token lacks sub or email');
    }
    return {
      subject: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
    };
  }
}
