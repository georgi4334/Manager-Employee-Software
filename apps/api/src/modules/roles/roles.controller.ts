import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  roleParentRequestSchema,
  roleRequestSchema,
  type RoleDetail,
  type RoleListItem,
  type RoleParentRequest,
  type RoleRequest,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RolesAdminService } from './roles-admin.service.js';

const idParam = new ZodValidationPipe(z.uuid());

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesAdminService) {}

  @Get()
  @RequirePermission('admin.role.view')
  @ApiOperation({ summary: 'Roles of the workspace' })
  list(): Promise<RoleListItem[]> {
    return this.roles.list();
  }

  @Get(':id')
  @RequirePermission('admin.role.view')
  @ApiOperation({ summary: 'One role with its grants' })
  get(@Param('id', idParam) id: string): Promise<RoleDetail> {
    return this.roles.get(id);
  }

  @Post()
  @RequirePermission('admin.role.manage')
  @ApiOperation({ summary: 'Create a custom role' })
  create(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(roleRequestSchema)) body: RoleRequest,
  ): Promise<RoleDetail> {
    return this.roles.create(actor, body);
  }

  @Put(':id')
  @RequirePermission('admin.role.manage')
  @ApiOperation({ summary: 'Replace name, description and grants of a custom role' })
  update(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(roleRequestSchema)) body: RoleRequest,
  ): Promise<RoleDetail> {
    return this.roles.update(actor, id, body);
  }

  @Put(':id/parent')
  @RequirePermission('admin.role.manage')
  @ApiOperation({ summary: 'Move a role in the tree (display only; grants never change)' })
  move(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(roleParentRequestSchema)) body: RoleParentRequest,
  ): Promise<RoleDetail> {
    return this.roles.move(actor, id, body.parentId);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('admin.role.manage')
  @ApiOperation({ summary: 'Delete a custom role nobody holds' })
  remove(@CurrentAuth() actor: RequestAuth, @Param('id', idParam) id: string): Promise<void> {
    return this.roles.remove(actor, id);
  }
}
