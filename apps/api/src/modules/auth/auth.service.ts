import { Injectable } from '@nestjs/common';
import type { CurrentUser, LoginRequest, Workspace } from '@intime/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { SystemPrismaService } from '../../infrastructure/prisma/system-prisma.service.js';
import { TenantContext } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { PermissionsService } from '../roles/permissions.service.js';
import type { IssuedTokens } from './cookies.js';
import { LoginAttemptLimiter } from './login-attempt-limiter.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

/** More matches than this for one email is not a real person; stop checking hashes. */
const MAX_CANDIDATES = 20;

export interface SignInResult {
  tokens: IssuedTokens;
  tenantId: string;
  userId: string;
}

export interface SignInCandidate {
  id: string;
  tenantId: string;
  status: string;
  tenant: Workspace;
}

/** Shared by password and Google sign-in: picks the one workspace or explains why it cannot. */
export function chooseCandidate<T extends SignInCandidate>(matches: T[]): T {
  if (matches.length === 0) {
    throw new AppException('INVALID_CREDENTIALS', { message: 'Invalid email or password' });
  }
  if (matches.length > 1) {
    throw new AppException('TENANT_SELECTION_REQUIRED', {
      message: 'The account exists in several workspaces',
      params: { workspaces: matches.map((m) => ({ slug: m.tenant.slug, name: m.tenant.name })) },
    });
  }
  const [match] = matches as [T];
  if (match.status !== 'active') {
    throw new AppException('ACCOUNT_DISABLED', { message: 'This account is disabled' });
  }
  return match;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly db: TenantDb,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly limiter: LoginAttemptLimiter,
    private readonly context: TenantContext,
    private readonly permissions: PermissionsService,
  ) {}

  async login({ email, password, workspace }: LoginRequest): Promise<SignInResult> {
    if (this.limiter.isBlocked(email)) {
      throw new AppException('RATE_LIMITED', {
        message: 'Too many failed sign-ins, try again later',
      });
    }

    const candidates = await this.system.user.findMany({
      where: {
        email,
        status: { in: ['active', 'disabled'] },
        ...(workspace ? { tenant: { slug: workspace } } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        status: true,
        tenant: { select: { slug: true, name: true } },
        identities: { where: { provider: 'password' }, select: { passwordHash: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_CANDIDATES,
    });

    const matches: SignInCandidate[] = [];
    let checked = 0;
    for (const candidate of candidates) {
      const passwordHash = candidate.identities[0]?.passwordHash;
      if (!passwordHash) continue;
      checked += 1;
      if (await this.passwords.verify(passwordHash, password)) matches.push(candidate);
    }
    if (checked === 0) await this.passwords.verifyDummy(password);

    if (matches.length === 0) this.limiter.recordFailure(email);
    const match = chooseCandidate(matches);
    this.limiter.reset(email);

    const tokens = await this.sessions.create(match.tenantId, match.id, 'password');
    return { tokens, tenantId: match.tenantId, userId: match.id };
  }

  /** The user who just signed in (the request has no tenant context yet). */
  currentUser(tenantId: string, userId: string): Promise<CurrentUser> {
    return this.context.run(tenantId, () => this.me(userId));
  }

  /** The signed-in user. Runs in the request's tenant context (set by AuthGuard). */
  me(userId: string): Promise<CurrentUser> {
    return this.db.tx(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          locale: true,
          timezone: true,
          tenant: { select: { slug: true, name: true } },
        },
      });
      const access = await this.permissions.forUser(tx, userId);
      return {
        id: user.id,
        email: user.email,
        locale: user.locale,
        timezone: user.timezone,
        workspace: user.tenant,
        roles: access.roles,
        permissions: access.permissions,
      };
    });
  }
}
