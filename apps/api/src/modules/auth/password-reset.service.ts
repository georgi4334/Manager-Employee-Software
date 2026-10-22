import { Injectable, Logger } from '@nestjs/common';
import { SystemPrismaService } from '../../infrastructure/prisma/system-prisma.service.js';
import { AuthTokenService } from './auth-token.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly system: SystemPrismaService,
    private readonly tokens: AuthTokenService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Emails a reset link to every active account with this email (optionally one workspace).
   * Callers always answer 202, whether or not an account exists (no account enumeration).
   */
  async requestReset(email: string, workspace?: string): Promise<void> {
    const users = await this.system.user.findMany({
      where: { email, status: 'active', ...(workspace ? { tenant: { slug: workspace } } : {}) },
      select: { id: true, tenantId: true },
      take: 20,
    });
    for (const user of users) {
      try {
        await this.tokens.runAsTenant(user.tenantId, (tx) =>
          this.tokens.issue(tx, user.id, 'password_reset'),
        );
      } catch (error) {
        // One failing workspace must not reveal anything or block the others.
        this.logger.error({ err: error, userId: user.id }, 'Could not send password reset email');
      }
    }
  }

  /** Sets the new password and signs the user out everywhere. */
  async reset(raw: string, password: string): Promise<void> {
    const token = await this.tokens.find(raw, 'password_reset');
    this.tokens.assertPasswordAllowed(password, token.email);
    const passwordHash = await this.passwords.hash(password);

    await this.tokens.runAsTenant(token.tenantId, async (tx) => {
      await this.tokens.claim(tx, token.id);
      await this.tokens.setPassword(tx, token.userId, passwordHash);
      await this.sessions.revokeAllForUser(tx, token.userId);
    });
  }
}
