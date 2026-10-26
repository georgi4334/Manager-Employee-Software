import { Body, Controller, Get, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  eraseEmployeeRequestSchema,
  retentionHoldRequestSchema,
  updateRetentionRequestSchema,
  type EraseEmployeeRequest,
  type PersonalDataExport,
  type RetentionHoldRequest,
  type RetentionOverview,
  type UpdateRetentionRequest,
} from '@intime/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PrivacyService } from './privacy.service.js';
import { RetentionService } from './retention.service.js';

const idParam = new ZodValidationPipe(z.uuid());
const download = (res: Response) => {
  res.setHeader('Content-Disposition', 'attachment; filename="intime-data-export.json"');
  res.setHeader('Cache-Control', 'no-store');
};

@ApiTags('privacy')
@Controller('privacy')
export class PrivacyController {
  constructor(
    private readonly privacy: PrivacyService,
    private readonly retention: RetentionService,
  ) {}

  @Get('export')
  @RequirePermission('gdpr.export_own')
  @ApiOperation({ summary: 'Download all data held about you (JSON)' })
  exportOwn(
    @CurrentAuth() actor: RequestAuth,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PersonalDataExport> {
    download(res);
    return this.privacy.export(actor);
  }

  @Get('export/:employeeId')
  @RequirePermission('gdpr.export_employee')
  @ApiOperation({ summary: 'Download the data held about an employee (subject access request)' })
  exportEmployee(
    @CurrentAuth() actor: RequestAuth,
    @Param('employeeId', idParam) employeeId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PersonalDataExport> {
    download(res);
    return this.privacy.export(actor, employeeId);
  }

  @Post('erase/:employeeId')
  @HttpCode(204)
  @RequirePermission('gdpr.erase_employee')
  @ApiOperation({ summary: 'Irreversibly anonymise a former employee' })
  erase(
    @CurrentAuth() actor: RequestAuth,
    @Param('employeeId', idParam) employeeId: string,
    @Body(new ZodValidationPipe(eraseEmployeeRequestSchema)) body: EraseEmployeeRequest,
  ): Promise<void> {
    void body; // the pipe is the check: only { confirm: true } gets here
    return this.privacy.erase(actor, employeeId);
  }

  @Get('retention')
  @RequirePermission('gdpr.manage_retention')
  @ApiOperation({ summary: 'The retention policy and who falls due soon (Bulgaria)' })
  retentionOverview(): Promise<RetentionOverview> {
    return this.retention.overview();
  }

  @Put('retention')
  @RequirePermission('gdpr.manage_retention')
  @ApiOperation({
    summary: 'Switch automatic erasure of former employees on or off; set the period',
  })
  updateRetention(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(updateRetentionRequestSchema)) body: UpdateRetentionRequest,
  ): Promise<RetentionOverview> {
    return this.retention.update(actor, body);
  }

  @Put('retention/holds/:employeeId')
  @RequirePermission('gdpr.manage_retention')
  @ApiOperation({ summary: 'Keep a person out of (or back in) the automatic erasure' })
  retentionHold(
    @CurrentAuth() actor: RequestAuth,
    @Param('employeeId', idParam) employeeId: string,
    @Body(new ZodValidationPipe(retentionHoldRequestSchema)) body: RetentionHoldRequest,
  ): Promise<RetentionOverview> {
    return this.retention.hold(actor, employeeId, body.held);
  }
}
