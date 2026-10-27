import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  compensationRequestSchema,
  type Compensation,
  type CompensationRequest,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CompensationService } from './compensation.service.js';

/** Pay is personal data of the highest sensitivity: no caching anywhere. */
const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

@ApiTags('employees')
@Controller('employees/:employeeId/compensation')
export class CompensationController {
  constructor(private readonly compensation: CompensationService) {}

  @Get()
  @RequirePermission('compensation.view')
  @ApiOperation({ summary: 'Salary and hourly rate records of a person' })
  get(
    @CurrentAuth() actor: RequestAuth,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Compensation> {
    noStore(res);
    return this.compensation.get(actor, employeeId);
  }

  @Put()
  @RequirePermission('compensation.manage')
  @ApiOperation({ summary: 'Set the pay from a date on' })
  set(
    @CurrentAuth() actor: RequestAuth,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(compensationRequestSchema)) body: CompensationRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Compensation> {
    noStore(res);
    return this.compensation.set(actor, employeeId, body);
  }

  @Delete(':rowId')
  @RequirePermission('compensation.manage')
  @ApiOperation({ summary: 'Remove one pay record' })
  remove(
    @CurrentAuth() actor: RequestAuth,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('rowId', ParseUUIDPipe) rowId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Compensation> {
    noStore(res);
    return this.compensation.remove(actor, employeeId, rowId);
  }
}
