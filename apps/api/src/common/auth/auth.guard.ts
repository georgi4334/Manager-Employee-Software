import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContext } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AccessTokenService } from '../../modules/auth/access-token.service.js';
import { ACCESS_COOKIE } from '../../modules/auth/cookies.js';
import { SessionService } from '../../modules/auth/session.service.js';
import { AppException } from '../errors/app-exception.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { IS_PUBLIC } from './decorators.js';

/**
 * Global guard: every route requires a valid access token and a live session unless marked @Public().
 * On success the request's tenant context is set, so all later data access is limited to that tenant.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
    private readonly sessions: SessionService,
    private readonly tenantContext: TenantContext,
    private readonly db: TenantDb,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: unknown = request.cookies?.[ACCESS_COOKIE];
    const claims = typeof token === 'string' ? await this.accessTokens.verify(token) : null;
    if (!claims) throw new AppException('UNAUTHENTICATED', { message: 'Authentication required' });

    this.tenantContext.setTenantId(claims.tenantId);
    const active = await this.db.tx((tx) =>
      this.sessions.isActive(tx, claims.userId, claims.sessionId),
    );
    if (!active)
      throw new AppException('UNAUTHENTICATED', { message: 'Session expired or revoked' });

    request.auth = claims;
    return true;
  }
}
