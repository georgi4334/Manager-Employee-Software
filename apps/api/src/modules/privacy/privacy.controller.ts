import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  eraseEmployeeRequestSchema,
  type EraseEmployeeRequest,
  type PersonalDataExport,
} from '@intime/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PrivacyService } from './privacy.service.js';

const idParam = new ZodValidationPipe(z.uuid());
const download = (res: Response) => {
  res.setHeader('Content-Disposition', 'attachment; filename="intime-data-export.json"');
  res.setHeader('Cache-Control', 'no-store');
};

@ApiTags('privacy')
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

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
}
