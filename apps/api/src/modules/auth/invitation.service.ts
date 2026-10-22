import { Injectable } from '@nestjs/common';
import { normalizeEmail, type InvitationInfo } from '@intime/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { AuthTokenService, tokenInvalid } from './auth-token.service.js';
import type { SignInResult } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

@Injectable()
export class InvitationService {
  constructor(
    private readonly tokens: AuthTokenService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly context: TenantContext,
  ) {}

  /**
   * Invites an email into the current tenant (or re-sends an open invitation). Must run inside that
   * tenant's transaction. Returns the new user's id and the invitation link.
   */
  async invite(tx: TenantTx, rawEmail: string): Promise<{ userId: string; link: string }> {
    const email = normalizeEmail(rawEmail);
    const existing = await tx.user.findUnique({
      where: { tenantId_email: { tenantId: this.context.requireTenantId(), email } },
      select: { id: true, status: true },
    });
    if (existing && existing.status !== 'invited') {
      throw new AppException('CONFLICT', {
        message: 'A user with this email already exists',
        params: { field: 'email' },
      });
    }
    const userId =
      existing?.id ?? (await tx.user.create({ data: { email }, select: { id: true } })).id;
    const link = await this.tokens.issue(tx, userId, 'invite');
    return { userId, link };
  }

  async inspect(raw: string): Promise<InvitationInfo> {
    const token = await this.tokens.find(raw, 'invite');
    if (token.userStatus !== 'invited') throw tokenInvalid();
    return { email: token.email, workspace: token.workspace };
  }

  /** Sets the password, activates the user and signs them in. */
  async accept(raw: string, password: string): Promise<SignInResult> {
    const token = await this.tokens.find(raw, 'invite');
    if (token.userStatus !== 'invited') throw tokenInvalid();
    this.tokens.assertPasswordAllowed(password, token.email);
    const passwordHash = await this.passwords.hash(password);

    await this.tokens.runAsTenant(token.tenantId, async (tx) => {
      await this.tokens.claim(tx, token.id);
      await this.tokens.setPassword(tx, token.userId, passwordHash);
      await tx.user.update({
        where: { id: token.userId },
        data: { status: 'active', emailVerifiedAt: new Date() },
      });
    });

    const tokens = await this.sessions.create(token.tenantId, token.userId, 'password');
    return { tokens, tenantId: token.tenantId, userId: token.userId };
  }
}
