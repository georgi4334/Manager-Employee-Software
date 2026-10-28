import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  dashboardLayoutRequestSchema,
  type DashboardLayout,
  type DashboardLayoutRequest,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { Authenticated, CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { DashboardService } from './dashboard.service.js';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('layout')
  @Authenticated()
  @ApiOperation({
    summary: 'The workspace dashboard layout (each widget still checks its own rights)',
  })
  layout(@CurrentAuth() actor: RequestAuth): Promise<DashboardLayout> {
    return this.dashboard.layout(actor);
  }

  @Put('layout')
  @RequirePermission('admin.tenant.settings')
  @ApiOperation({ summary: 'Set the widgets of the workspace dashboard and their order' })
  update(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(dashboardLayoutRequestSchema)) body: DashboardLayoutRequest,
  ): Promise<DashboardLayout> {
    return this.dashboard.update(actor, body);
  }

  @Delete('layout')
  @RequirePermission('admin.tenant.settings')
  @ApiOperation({ summary: 'Go back to the default dashboard' })
  reset(@CurrentAuth() actor: RequestAuth): Promise<DashboardLayout> {
    return this.dashboard.reset(actor);
  }
}
