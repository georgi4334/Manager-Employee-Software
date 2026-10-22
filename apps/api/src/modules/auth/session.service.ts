import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { SystemPrismaService } from '../../infrastructure/prisma/system-prisma.service.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AccessTokenService } from './access-token.service.js';
import type { IssuedTokens } from './cookies.js';
import { randomToken, sha256 } from './crypto.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** Two browser tabs refreshing at the same moment is normal, not theft. */
export const REFRESH_REUSE_GRACE_MS = 30_000;

export type SessionMethod = 'password' | 'google';

type RefreshOutcome = { kind: 'ok'; tokens: IssuedTokens } | { kind: 'rejected' };

const unauthenticated = () =>
  new AppException('UNAUTHENTICATED', { message: 'Session expired or invalid' });

@Injectable()
export class SessionService {
  constructor(
    @Inject(APP_CONFIG) private readonly env: Env,
    private readonly system: SystemPrismaService,
    private readonly context: TenantContext,
    private readonly db: TenantDb,
    private readonly accessTokens: AccessTokenService,
  ) {}

  /** Starts a session for a user who has just proven their identity. */
  create(
    tenantId: string,
    userId: string,
    method: SessionMethod,
    now = new Date(),
  ): Promise<IssuedTokens> {
    return this.context.run(tenantId, () =>
      this.db.tx(async (tx) => {
        const session = await tx.session.create({
          data: {
            userId,
            method,
            expiresAt: new Date(now.getTime() + this.env.SESSION_MAX_DAYS * DAY_MS),
          },
        });
        await tx.user.update({ where: { id: userId }, data: { lastLoginAt: now } });
        return this.issue(
          tx,
          { tenantId, userId, sessionId: session.id, sessionExpiresAt: session.expiresAt },
          now,
        );
      }),
    );
  }

  /** Exchanges a refresh token for new tokens (rotation). See docs/adr/0002 for re-use handling. */
  async refresh(rawToken: string | undefined, now = new Date()): Promise<IssuedTokens> {
    if (!rawToken || !TOKEN_PATTERN.test(rawToken)) throw unauthenticated();

    // Which tenant a token belongs to is only knowable across tenants.
    const found = await this.system.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      select: { id: true, tenantId: true },
    });
    if (!found) throw unauthenticated();

    const outcome = await this.context.run(found.tenantId, () =>
      this.db.tx(async (tx): Promise<RefreshOutcome> => {
        const claimed = await tx.refreshToken.updateMany({
          where: { id: found.id, usedAt: null },
          data: { usedAt: now },
        });
        const token = await tx.refreshToken.findUniqueOrThrow({
          where: { id: found.id },
          select: {
            expiresAt: true,
            usedAt: true,
            session: {
              select: {
                id: true,
                userId: true,
                expiresAt: true,
                revokedAt: true,
                user: { select: { status: true } },
              },
            },
          },
        });

        if (claimed.count === 0) {
          const usedAt = token.usedAt?.getTime() ?? now.getTime();
          if (now.getTime() - usedAt > REFRESH_REUSE_GRACE_MS) {
            // An old token came back: assume it was stolen and end the whole session.
            await tx.session.update({ where: { id: token.session.id }, data: { revokedAt: now } });
          }
          return { kind: 'rejected' };
        }

        const { session } = token;
        const valid =
          token.expiresAt > now &&
          session.revokedAt === null &&
          session.expiresAt > now &&
          session.user.status === 'active';
        if (!valid) return { kind: 'rejected' };

        const tokens = await this.issue(
          tx,
          {
            tenantId: found.tenantId,
            userId: session.userId,
            sessionId: session.id,
            sessionExpiresAt: session.expiresAt,
          },
          now,
        );
        return { kind: 'ok', tokens };
      }),
    );

    // Thrown after the transaction so a theft revocation is committed, not rolled back.
    if (outcome.kind === 'rejected') throw unauthenticated();
    return outcome.tokens;
  }

  /** Ends the session a refresh token belongs to. Unknown tokens are ignored (logout always succeeds). */
  async revokeByRefreshToken(rawToken: string | undefined, now = new Date()): Promise<void> {
    if (!rawToken || !TOKEN_PATTERN.test(rawToken)) return;
    const found = await this.system.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      select: { tenantId: true, sessionId: true },
    });
    if (!found) return;
    await this.context.run(found.tenantId, () =>
      this.db.tx((tx) =>
        tx.session.updateMany({
          where: { id: found.sessionId, revokedAt: null },
          data: { revokedAt: now },
        }),
      ),
    );
  }

  /** Ends every session of a user (password reset, disabling). Must run inside the user's tenant. */
  async revokeAllForUser(tx: TenantTx, userId: string, now = new Date()): Promise<number> {
    const result = await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return result.count;
  }

  /** True when the session behind an access token is still usable. Runs inside the token's tenant. */
  isActive(tx: TenantTx, userId: string, sessionId: string, now = new Date()): Promise<boolean> {
    return tx.session
      .count({
        where: {
          id: sessionId,
          userId,
          revokedAt: null,
          expiresAt: { gt: now },
          user: { status: 'active' },
        },
      })
      .then((count) => count === 1);
  }

  private async issue(
    tx: TenantTx,
    session: { tenantId: string; userId: string; sessionId: string; sessionExpiresAt: Date },
    now: Date,
  ): Promise<IssuedTokens> {
    const refreshToken = randomToken();
    const refreshExpiresAt = new Date(
      Math.min(
        now.getTime() + this.env.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
        session.sessionExpiresAt.getTime(),
      ),
    );
    await tx.refreshToken.create({
      data: {
        sessionId: session.sessionId,
        tokenHash: sha256(refreshToken),
        expiresAt: refreshExpiresAt,
      },
    });
    const accessToken = await this.accessTokens.sign(
      { userId: session.userId, tenantId: session.tenantId, sessionId: session.sessionId },
      now,
    );
    return { accessToken, refreshToken, refreshExpiresAt };
  }
}
