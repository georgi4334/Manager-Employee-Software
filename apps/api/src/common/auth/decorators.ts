import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PermissionCode } from '@intime/contracts';
import type { AuthenticatedRequest, RequestAuth } from './auth.types.js';

export const IS_PUBLIC = 'intime:isPublic';
export const IS_AUTHENTICATED = 'intime:isAuthenticated';
export const REQUIRED_PERMISSIONS = 'intime:requiredPermissions';

/** No sign-in needed (login, health, one-time links). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Any signed-in user, whatever their roles (e.g. "who am I"). */
export const Authenticated = () => SetMetadata(IS_AUTHENTICATED, true);

/**
 * The caller must hold every listed permission (at any scope). The service then applies the scope to the
 * concrete record with AuthorizationService.assert(...).
 */
export const RequirePermission = (...permissions: [PermissionCode, ...PermissionCode[]]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** The authenticated user of the request (only on non-public routes). */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestAuth => {
    const auth = ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) throw new Error('CurrentAuth used on a route without authentication');
    return auth;
  },
);
