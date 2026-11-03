import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { auditQuerySchema, type AuditPage, type AuditQuery } from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuditLogService } from './audit-log.service.js';

@ApiTags('audit')
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly log: AuditLogService) {}

  @Get()
  @RequirePermission('admin.audit_log.view')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Audit log entries of the areas the caller administers, newest first',
  })
  list(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
  ): Promise<AuditPage> {
    return this.log.list(actor, query);
  }
}
