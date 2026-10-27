import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  inviteUserRequestSchema,
  setUserRolesRequestSchema,
  type InviteUserRequest,
  type SetUserRolesRequest,
  type UserSummary,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { UsersService } from './users.service.js';

const idParam = new ZodValidationPipe(z.uuid());

@ApiTags('users')
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  @RequirePermission('admin.user.view')
  @ApiOperation({ summary: 'User accounts with their roles' })
  list(): Promise<UserSummary[]> {
    return this.users.listUsers();
  }

  @Post('users/invitations')
  @RequirePermission('admin.user.invite')
  @ApiOperation({
    summary: 'Invite a user by email (roles beyond Employee need admin.role.assign)',
  })
  invite(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(inviteUserRequestSchema)) body: InviteUserRequest,
  ): Promise<UserSummary> {
    return this.users.invite(actor, body.email, body.roleIds);
  }

  @Put('users/:id/roles')
  @RequirePermission('admin.role.assign')
  @ApiOperation({ summary: 'Replace the roles of a user' })
  setRoles(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(setUserRolesRequestSchema)) body: SetUserRolesRequest,
  ): Promise<UserSummary> {
    return this.users.setRoles(actor, id, body.roleIds);
  }

  @Post('users/:id/disable')
  @HttpCode(200)
  @RequirePermission('admin.user.disable')
  @ApiOperation({ summary: 'Disable an account and end all its sessions' })
  disable(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
  ): Promise<UserSummary> {
    return this.users.disable(actor, id);
  }

  @Post('users/:id/enable')
  @HttpCode(200)
  @RequirePermission('admin.user.disable')
  @ApiOperation({ summary: 'Re-enable a disabled account' })
  enable(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
  ): Promise<UserSummary> {
    return this.users.enable(actor, id);
  }
}
