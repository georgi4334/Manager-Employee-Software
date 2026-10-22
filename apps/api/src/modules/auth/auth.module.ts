import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthTokenService } from './auth-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GoogleAuthService } from './google-auth.service.js';
import { GOOGLE_OIDC, GoogleOidcClient } from './google-oidc.client.js';
import { InvitationService } from './invitation.service.js';
import { LoginAttemptLimiter } from './login-attempt-limiter.js';
import { PasswordResetService } from './password-reset.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AccessTokenService,
    AuthService,
    AuthTokenService,
    GoogleAuthService,
    InvitationService,
    PasswordResetService,
    PasswordService,
    SessionService,
    { provide: LoginAttemptLimiter, useFactory: () => new LoginAttemptLimiter() },
    {
      provide: GOOGLE_OIDC,
      inject: [APP_CONFIG],
      useFactory: (env: Env) => (env.GOOGLE ? new GoogleOidcClient(env.GOOGLE) : null),
    },
  ],
  exports: [AccessTokenService, SessionService, InvitationService, AuthTokenService],
})
export class AuthModule {}
