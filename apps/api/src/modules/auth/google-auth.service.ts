import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { normalizeEmail } from '@intime/contracts';
import { SignJWT, jwtVerify } from 'jose';
import { AppException } from '../../common/errors/app-exception.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { SystemPrismaService } from '../../infrastructure/prisma/system-prisma.service.js';
import { TenantContext } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { chooseCandidate, type SignInResult } from './auth.service.js';
import { pkceChallenge, randomToken } from './crypto.js';
import { GOOGLE_OIDC, GoogleOidcError, type GoogleOidcClient } from './google-oidc.client.js';
import { SessionService } from './session.service.js';

const FLOW_AUDIENCE = 'intime-google-flow';

interface FlowState {
  state: string;
  nonce: string;
  verifier: string;
  workspace?: string;
}

const googleFailed = (message: string) => new AppException('INVALID_CREDENTIALS', { message });

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Google sign-in for existing (invited) users; see docs/adr/0002-authentication.md. */
@Injectable()
export class GoogleAuthService {
  private readonly flowKey: Uint8Array;

  constructor(
    @Inject(APP_CONFIG) env: Env,
    @Optional() @Inject(GOOGLE_OIDC) private readonly google: GoogleOidcClient | null,
    private readonly system: SystemPrismaService,
    private readonly context: TenantContext,
    private readonly db: TenantDb,
    private readonly sessions: SessionService,
  ) {
    this.flowKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  get enabled(): boolean {
    return this.google !== null;
  }

  /** Returns Google's consent URL and the signed, short-lived flow state to keep in a cookie. */
  async start(workspace?: string): Promise<{ url: string; flowCookie: string }> {
    const google = this.requireGoogle();
    const flow: FlowState = {
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(),
      workspace,
    };
    const flowCookie = await new SignJWT({ ...flow })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience(FLOW_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(this.flowKey);
    const url = google.authorizationUrl({
      state: flow.state,
      nonce: flow.nonce,
      codeChallenge: pkceChallenge(flow.verifier),
    });
    return { url, flowCookie };
  }

  async finish(
    query: { code?: string; state?: string; error?: string },
    flowCookie: string | undefined,
  ): Promise<SignInResult> {
    const google = this.requireGoogle();
    if (query.error) throw googleFailed(`Google returned an error: ${query.error}`);
    if (!query.code || !query.state || !flowCookie)
      throw googleFailed('Incomplete Google callback');

    const flow = await this.readFlow(flowCookie);
    if (!sameString(flow.state, query.state)) throw googleFailed('Google state mismatch');

    let identity;
    try {
      const idToken = await google.exchangeCode(query.code, flow.verifier);
      identity = await google.verifyIdToken(idToken, flow.nonce);
    } catch (error) {
      if (error instanceof GoogleOidcError) throw googleFailed(error.message);
      throw error;
    }
    if (!identity.emailVerified) throw googleFailed('Google email is not verified');

    const candidates = await this.system.user.findMany({
      where: {
        email: normalizeEmail(identity.email),
        status: { in: ['active', 'disabled'] },
        ...(flow.workspace ? { tenant: { slug: flow.workspace } } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        status: true,
        tenant: { select: { slug: true, name: true } },
        identities: { where: { provider: 'google' }, select: { providerSubject: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    // An account already linked to a different Google account must not be taken over.
    const matches = candidates.filter((c) => {
      const linked = c.identities[0]?.providerSubject;
      return linked === undefined || linked === identity.subject;
    });
    const match = chooseCandidate(matches);

    if (match.identities.length === 0) {
      await this.context.run(match.tenantId, () =>
        this.db.tx((tx) =>
          tx.authIdentity.create({
            data: { userId: match.id, provider: 'google', providerSubject: identity.subject },
          }),
        ),
      );
    }

    const tokens = await this.sessions.create(match.tenantId, match.id, 'google');
    return { tokens, tenantId: match.tenantId, userId: match.id };
  }

  private requireGoogle(): GoogleOidcClient {
    if (!this.google)
      throw new AppException('NOT_FOUND', { message: 'Google sign-in is not configured' });
    return this.google;
  }

  private async readFlow(cookie: string): Promise<FlowState> {
    try {
      const { payload } = await jwtVerify(cookie, this.flowKey, {
        audience: FLOW_AUDIENCE,
        algorithms: ['HS256'],
      });
      const { state, nonce, verifier, workspace } = payload;
      if (typeof state !== 'string' || typeof nonce !== 'string' || typeof verifier !== 'string') {
        throw new Error('malformed');
      }
      return {
        state,
        nonce,
        verifier,
        workspace: typeof workspace === 'string' ? workspace : undefined,
      };
    } catch {
      throw googleFailed('Google sign-in expired or was tampered with');
    }
  }
}
