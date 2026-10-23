import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, type PermissionCode } from '@intime/contracts';
import { AppException } from '../errors/app-exception.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { IS_AUTHENTICATED, IS_PUBLIC, REQUIRED_PERMISSIONS } from './decorators.js';

/**
 * Global guard, runs after AuthGuard. Every route must declare its protection with @Public(),
 * @Authenticated() or @RequirePermission(...). A route that declares nothing is refused (fail closed),
 * so a forgotten decorator can never expose an endpoint to every signed-in user.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;
    if (!auth) throw new AppException('UNAUTHENTICATED', { message: 'Authentication required' });

    const required = this.reflector.getAllAndOverride<PermissionCode[] | undefined>(
      REQUIRED_PERMISSIONS,
      targets,
    );
    if (required) {
      const missing = required.find((code) => !hasPermission(auth.permissions, code));
      if (missing)
        throw new AppException('FORBIDDEN', { message: `Missing permission ${missing}` });
      return true;
    }

    if (this.reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED, targets)) return true;
    throw new AppException('FORBIDDEN', { message: 'Route has no access declaration' });
  }
}
