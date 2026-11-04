import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  updateWorkspaceSettingsRequestSchema,
  type UpdateWorkspaceSettingsRequest,
  type WorkspaceSettings,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { Authenticated, CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { WorkspaceSettingsService } from './workspace-settings.service.js';

@ApiTags('workspace')
@Controller('settings/workspace')
export class WorkspaceSettingsController {
  constructor(private readonly settings: WorkspaceSettingsService) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: "The caller's workspace: name, slug, time zone, language, country" })
  get(@CurrentAuth() actor: RequestAuth): Promise<WorkspaceSettings> {
    return this.settings.get(actor);
  }

  @Put()
  @RequirePermission('admin.tenant.settings')
  @ApiOperation({ summary: 'Change the workspace name, time zone, default language or country' })
  update(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(updateWorkspaceSettingsRequestSchema))
    body: UpdateWorkspaceSettingsRequest,
  ): Promise<WorkspaceSettings> {
    return this.settings.update(actor, body);
  }
}
