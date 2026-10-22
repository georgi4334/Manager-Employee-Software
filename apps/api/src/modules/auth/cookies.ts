import type { CookieOptions, Response } from 'express';
import type { Env } from '../../config/env.js';

export const ACCESS_COOKIE = 'intime_at';
export const REFRESH_COOKIE = 'intime_rt';
export const GOOGLE_FLOW_COOKIE = 'intime_g';

/** Paths limit where the browser sends each cookie: the refresh token only goes to /auth endpoints. */
export const ACCESS_COOKIE_PATH = '/api';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
export const GOOGLE_FLOW_COOKIE_PATH = '/api/v1/auth/google';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

function base(env: Env): CookieOptions {
  return { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax' };
}

export function setAuthCookies(res: Response, env: Env, tokens: IssuedTokens): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base(env),
    path: ACCESS_COOKIE_PATH,
    maxAge: env.ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(env),
    path: REFRESH_COOKIE_PATH,
    expires: tokens.refreshExpiresAt,
  });
}

export function clearAuthCookies(res: Response, env: Env): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(env), path: ACCESS_COOKIE_PATH });
  res.clearCookie(REFRESH_COOKIE, { ...base(env), path: REFRESH_COOKIE_PATH });
}

export function setGoogleFlowCookie(res: Response, env: Env, value: string): void {
  res.cookie(GOOGLE_FLOW_COOKIE, value, {
    ...base(env),
    path: GOOGLE_FLOW_COOKIE_PATH,
    maxAge: 10 * 60 * 1000,
  });
}

export function clearGoogleFlowCookie(res: Response, env: Env): void {
  res.clearCookie(GOOGLE_FLOW_COOKIE, { ...base(env), path: GOOGLE_FLOW_COOKIE_PATH });
}
