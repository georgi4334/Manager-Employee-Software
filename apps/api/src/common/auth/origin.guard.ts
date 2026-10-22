import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AppException } from '../errors/app-exception.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth (cookies are already SameSite=Lax): a state-changing request sent by a browser
 * from a foreign origin is rejected. Requests without an Origin header (server-to-server, curl) pass.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(@Inject(APP_CONFIG) env: Env) {
    this.allowed = new Set([env.WEB_APP_ORIGIN, ...env.CORS_ORIGINS.map((o) => new URL(o).origin)]);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    const origin = request.headers.origin;
    if (origin === undefined || this.allowed.has(origin)) return true;
    throw new AppException('FORBIDDEN', { message: 'Cross-origin request rejected' });
  }
}
