import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { APP_CONFIG } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { isUuid } from '../../infrastructure/tenancy/tenant-context.js';

export interface AccessClaims {
  userId: string;
  tenantId: string;
  sessionId: string;
}

const ISSUER = 'intime-api';
const AUDIENCE = 'intime-web';

@Injectable()
export class AccessTokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly env: Env) {
    this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  sign(claims: AccessClaims, now = new Date()): Promise<string> {
    const issuedAt = Math.floor(now.getTime() / 1000);
    return new SignJWT({ tid: claims.tenantId, sid: claims.sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.env.ACCESS_TOKEN_TTL_SECONDS)
      .sign(this.key);
  }

  /** Returns the claims of a valid token, or null for anything invalid, expired or tampered with. */
  async verify(token: string, now = new Date()): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
        currentDate: now,
      });
      const { sub, tid, sid } = payload;
      if (!isUuid(sub) || !isUuid(tid) || !isUuid(sid)) return null;
      return { userId: sub, tenantId: tid, sessionId: sid };
    } catch {
      return null;
    }
  }
}
