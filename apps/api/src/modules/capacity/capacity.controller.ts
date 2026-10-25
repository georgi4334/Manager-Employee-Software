import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { capacityQuerySchema, type Capacity, type CapacityQuery } from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CapacityService } from './capacity.service.js';

@ApiTags('capacity')
@Controller('capacity')
export class CapacityController {
  constructor(private readonly capacity: CapacityService) {}

  @Get()
  @RequirePermission('capacity.view')
  @ApiOperation({ summary: 'Available, planned and logged time of the people you may see' })
  overview(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(capacityQuerySchema)) query: CapacityQuery,
  ): Promise<Capacity> {
    return this.capacity.overview(actor, query);
  }
}
