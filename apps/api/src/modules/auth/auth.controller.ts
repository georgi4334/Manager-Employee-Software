import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  acceptInvitationRequestSchema,
  forgotPasswordRequestSchema,
  inspectInvitationRequestSchema,
  loginRequestSchema,
  resetPasswordRequestSchema,
  workspaceSlugSchema,
  type CurrentUser,
  type InvitationInfo,
} from '@intime/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, Public } from '../../common/auth/decorators.js';
import { AppException } from '../../common/errors/app-exception.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AuthService } from './auth.service.js';
import {
  GOOGLE_FLOW_COOKIE,
  REFRESH_COOKIE,
  clearAuthCookies,
  clearGoogleFlowCookie,
  setAuthCookies,
  setGoogleFlowCookie,
} from './cookies.js';
import { GoogleAuthService } from './google-auth.service.js';
import { InvitationService } from './invitation.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { SessionService } from './session.service.js';

const MINUTE = 60_000;
const googleStartQuery = z.object({ workspace: workspaceSlugSchema.optional() });
const googleCallbackQuery = z.object({
  code: z.string().max(2048).optional(),
  state: z.string().max(256).optional(),
  error: z.string().max(256).optional(),
});

function cookie(req: Request, name: string): string | undefined {
  const value: unknown = req.cookies?.[name];
  return typeof value === 'string' ? value : undefined;
}

@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
// Per-IP limits are generous because a whole office may share one IP; guessing a password is slowed
// down per email by LoginAttemptLimiter instead.
@Throttle({ default: { limit: 120, ttl: MINUTE } })
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    @Inject(APP_CONFIG) private readonly env: Env,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly invitations: InvitationService,
    private readonly passwordReset: PasswordResetService,
    private readonly google: GoogleAuthService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: MINUTE } })
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: z.infer<typeof loginRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CurrentUser> {
    const result = await this.auth.login(body);
    setAuthCookies(res, this.env, result.tokens);
    return this.auth.currentUser(result.tenantId, result.userId);
  }

  @Public()
  @Post('refresh')
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: MINUTE } })
  @ApiOperation({ summary: 'Rotate the session tokens (refresh-token cookie)' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    try {
      setAuthCookies(res, this.env, await this.sessions.refresh(cookie(req, REFRESH_COOKIE)));
    } catch (error) {
      clearAuthCookies(res, this.env);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'End the session and clear the cookies' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.revokeByRefreshToken(cookie(req, REFRESH_COOKIE));
    clearAuthCookies(res, this.env);
  }

  @Get('me')
  @ApiOperation({ summary: 'The signed-in user' })
  me(@CurrentAuth() auth: RequestAuth): Promise<CurrentUser> {
    return this.auth.me(auth.userId);
  }

  @Public()
  @Post('invitations/inspect')
  @HttpCode(200)
  @ApiOperation({ summary: 'Email and workspace of an invitation link' })
  inspectInvitation(
    @Body(new ZodValidationPipe(inspectInvitationRequestSchema)) body: { token: string },
  ): Promise<InvitationInfo> {
    return this.invitations.inspect(body.token);
  }

  @Public()
  @Post('invitations/accept')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: MINUTE } })
  @ApiOperation({ summary: 'Set a password for an invitation and sign in' })
  async acceptInvitation(
    @Body(new ZodValidationPipe(acceptInvitationRequestSchema))
    body: z.infer<typeof acceptInvitationRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CurrentUser> {
    const result = await this.invitations.accept(body.token, body.password);
    setAuthCookies(res, this.env, result.tokens);
    return this.auth.currentUser(result.tenantId, result.userId);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 15 * MINUTE } })
  @ApiOperation({ summary: 'Email a password-reset link (always 202)' })
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordRequestSchema))
    body: z.infer<typeof forgotPasswordRequestSchema>,
  ): Promise<void> {
    await this.passwordReset.requestReset(body.email, body.workspace);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 15 * MINUTE } })
  @ApiOperation({ summary: 'Set a new password with a reset link; signs out everywhere' })
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordRequestSchema))
    body: z.infer<typeof resetPasswordRequestSchema>,
  ): Promise<void> {
    await this.passwordReset.reset(body.token, body.password);
  }

  @Public()
  @Get('google/start')
  @ApiOperation({ summary: 'Redirect to Google sign-in' })
  async googleStart(
    @Query(new ZodValidationPipe(googleStartQuery)) query: z.infer<typeof googleStartQuery>,
    @Res() res: Response,
  ): Promise<void> {
    const { url, flowCookie } = await this.google.start(query.workspace);
    setGoogleFlowCookie(res, this.env, flowCookie);
    res.redirect(302, url);
  }

  @Public()
  @Get('google/callback')
  @ApiOperation({
    summary: 'Google redirects back here; finishes sign-in and returns to the web app',
  })
  async googleCallback(
    @Query(new ZodValidationPipe(googleCallbackQuery)) query: z.infer<typeof googleCallbackQuery>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.google.enabled)
      throw new AppException('NOT_FOUND', { message: 'Google sign-in is not configured' });
    clearGoogleFlowCookie(res, this.env);
    const webApp = this.env.WEB_APP_URL.replace(/\/$/, '');
    try {
      const result = await this.google.finish(query, cookie(req, GOOGLE_FLOW_COOKIE));
      setAuthCookies(res, this.env, result.tokens);
      res.redirect(302, `${webApp}/`);
    } catch (error) {
      const code = error instanceof AppException ? error.code : 'INTERNAL_ERROR';
      if (!(error instanceof AppException))
        this.logger.error({ err: error }, 'Google sign-in failed');
      res.redirect(302, `${webApp}/login?error=${code}`);
    }
  }
}
