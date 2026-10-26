import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { analyticsQuerySchema, type Analytics, type AnalyticsQuery } from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AnalyticsService } from './analytics.service.js';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  @RequirePermission('analytics.view_team')
  @ApiOperation({ summary: 'Aggregated figures over the people and projects you may see' })
  overview(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
  ): Promise<Analytics> {
    return this.analytics.overview(actor, query);
  }
}
