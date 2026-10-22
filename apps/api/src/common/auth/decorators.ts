import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, RequestAuth } from './auth.types.js';

export const IS_PUBLIC = 'intime:isPublic';

/** Opts a route out of the global authentication requirement. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The authenticated user of the request (only on non-public routes). */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestAuth => {
    const auth = ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) throw new Error('CurrentAuth used on a route without authentication');
    return auth;
  },
);
