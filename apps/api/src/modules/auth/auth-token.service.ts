import { Inject, Injectable } from '@nestjs/common';
import { passwordProblems } from '@intime/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { MAILER, type Mailer } from '../../infrastructure/mail/mailer.js';
import {
  renderEmail,
  resolveEmailLocale,
  type EmailKind,
} from '../../infrastructure/mail/templates.js';
import { SystemPrismaService } from '../../infrastructure/prisma/system-prisma.service.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { randomToken, sha256 } from './crypto.js';

export type AuthTokenPurpose = 'invite' | 'password_reset';

const HOUR_MS = 60 * 60 * 1000;
export const TOKEN_TTL_HOURS: Record<AuthTokenPurpose, number> = {
  invite: 7 * 24,
  password_reset: 1,
};
const LINK_PATH: Record<AuthTokenPurpose, string> = {
  invite: '/accept-invitation',
  password_reset: '/reset-password',
};
const EMAIL_KIND: Record<AuthTokenPurpose, EmailKind> = {
  invite: 'invite',
  password_reset: 'password_reset',
};

export interface ValidToken {
  id: string;
  tenantId: string;
  userId: string;
  email: string;
  userStatus: string;
  workspace: { slug: string; name: string };
}

export const tokenInvalid = () =>
  new AppException('TOKEN_INVALID', { message: 'The link is invalid, expired or already used' });

/** One-time links for invitations and password resets (docs/adr/0002-authentication.md). */
@Injectable()
export class AuthTokenService {
  constructor(
    @Inject(APP_CONFIG) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly system: SystemPrismaService,
    private readonly context: TenantContext,
    private readonly db: TenantDb,
  ) {}

  /**
   * Creates a fresh link (older unused links of the same purpose stop working) and emails it.
   * Must run inside the user's tenant transaction. Returns the link (the CLI prints it).
   */
  async issue(
    tx: TenantTx,
    userId: string,
    purpose: AuthTokenPurpose,
    now = new Date(),
  ): Promise<string> {
    await tx.authToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: now },
    });
    const raw = randomToken();
    const hours = TOKEN_TTL_HOURS[purpose];
    await tx.authToken.create({
      data: {
        userId,
        purpose,
        tokenHash: sha256(raw),
        expiresAt: new Date(now.getTime() + hours * HOUR_MS),
      },
    });

    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        email: true,
        locale: true,
        tenant: { select: { name: true, defaultLocale: true } },
      },
    });
    const link = `${this.env.WEB_APP_URL.replace(/\/$/, '')}${LINK_PATH[purpose]}?token=${raw}`;
    const locale = resolveEmailLocale(user.locale, user.tenant.defaultLocale);
    await this.mailer.send({
      to: user.email,
      ...renderEmail(EMAIL_KIND[purpose], locale, { workspace: user.tenant.name, link, hours }),
    });
    return link;
  }

  /** Looks a raw token up across tenants; throws TOKEN_INVALID unless it is usable right now. */
  async find(raw: string, purpose: AuthTokenPurpose, now = new Date()): Promise<ValidToken> {
    const token = await this.system.authToken.findUnique({
      where: { tokenHash: sha256(raw) },
      select: {
        id: true,
        tenantId: true,
        purpose: true,
        expiresAt: true,
        usedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            status: true,
            tenant: { select: { slug: true, name: true } },
          },
        },
      },
    });
    if (!token || token.purpose !== purpose || token.usedAt !== null || token.expiresAt <= now) {
      throw tokenInvalid();
    }
    return {
      id: token.id,
      tenantId: token.tenantId,
      userId: token.user.id,
      email: token.user.email,
      userStatus: token.user.status,
      workspace: token.user.tenant,
    };
  }

  /** Marks the token used; only the first caller wins, so a link works exactly once. */
  async claim(tx: TenantTx, tokenId: string, now = new Date()): Promise<void> {
    const claimed = await tx.authToken.updateMany({
      where: { id: tokenId, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw tokenInvalid();
  }

  /** Throws VALIDATION_FAILED for passwords that pass the length rule but not the contextual ones. */
  assertPasswordAllowed(password: string, email: string): void {
    const problems = passwordProblems(password, email);
    if (problems.length > 0) {
      throw new AppException('VALIDATION_FAILED', {
        message: 'Password does not meet the policy',
        details: problems.map((code) => ({ path: 'password', code, message: code })),
      });
    }
  }

  /** Sets (or replaces) the password sign-in method of a user inside their tenant transaction. */
  async setPassword(tx: TenantTx, userId: string, passwordHash: string): Promise<void> {
    await tx.authIdentity.upsert({
      where: { userId_provider: { userId, provider: 'password' } },
      create: { userId, provider: 'password', providerSubject: userId, passwordHash },
      update: { passwordHash },
    });
  }

  runAsTenant<T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.context.run(tenantId, () => this.db.tx(fn));
  }
}
