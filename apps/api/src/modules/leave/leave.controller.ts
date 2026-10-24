import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  adjustBalanceRequestSchema,
  balanceQuerySchema,
  createHolidayRequestSchema,
  createLeaveRequestSchema,
  createLeaveTypeRequestSchema,
  decisionRequestSchema,
  holidayQuerySchema,
  leaveRequestQuerySchema,
  previewLeaveRequestSchema,
  updateLeaveSettingsRequestSchema,
  updateLeaveTypeRequestSchema,
  type AdjustBalanceRequest,
  type BalanceQuery,
  type CreateHolidayRequest,
  type CreateLeaveRequest,
  type CreateLeaveTypeRequest,
  type DecisionRequest,
  type Holiday,
  type HolidayQuery,
  type LeaveBalance,
  type LeaveBalances,
  type LeavePreview,
  type LeaveRequest,
  type LeaveRequestList,
  type LeaveRequestQuery,
  type LeaveSettings,
  type LeaveType,
  type PreviewLeaveRequest,
  type UpdateLeaveSettingsRequest,
  type UpdateLeaveTypeRequest,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { Authenticated, CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { LeaveBalancesService } from './leave-balances.service.js';
import { LeaveRequestsService } from './leave-requests.service.js';
import { LeaveSettingsService } from './leave-settings.service.js';
import { LeaveTypesService } from './leave-types.service.js';

const idParam = new ZodValidationPipe(z.uuid());

@ApiTags('leave')
@Controller('leave')
export class LeaveController {
  constructor(
    private readonly types: LeaveTypesService,
    private readonly settings: LeaveSettingsService,
    private readonly balances: LeaveBalancesService,
    private readonly requests: LeaveRequestsService,
    private readonly db: TenantDb,
  ) {}

  // ----- types and settings --------------------------------------------------------------------

  @Get('types')
  @Authenticated()
  @ApiOperation({ summary: 'Leave types with their policy (inactive ones only for HR)' })
  listTypes(@CurrentAuth() actor: RequestAuth): Promise<LeaveType[]> {
    return this.types.list(actor);
  }

  @Post('types')
  @RequirePermission('leave.manage_types_policies')
  @ApiOperation({ summary: 'Create a custom leave type' })
  createType(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createLeaveTypeRequestSchema)) body: CreateLeaveTypeRequest,
  ): Promise<LeaveType> {
    return this.types.create(actor, body);
  }

  @Patch('types/:id')
  @RequirePermission('leave.manage_types_policies')
  @ApiOperation({ summary: 'Change a leave type or its policy' })
  updateType(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(updateLeaveTypeRequestSchema)) body: UpdateLeaveTypeRequest,
  ): Promise<LeaveType> {
    return this.types.update(actor, id, body);
  }

  @Get('settings')
  @RequirePermission('leave.manage_types_policies')
  @ApiOperation({ summary: 'Workspace leave settings' })
  getSettings(): Promise<LeaveSettings> {
    return this.settings.get();
  }

  @Put('settings')
  @RequirePermission('leave.manage_types_policies')
  @ApiOperation({ summary: 'Change workspace leave settings' })
  updateSettings(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(updateLeaveSettingsRequestSchema)) body: UpdateLeaveSettingsRequest,
  ): Promise<LeaveSettings> {
    return this.settings.update(actor, body);
  }

  // ----- holidays ------------------------------------------------------------------------------

  @Get('holidays')
  @Authenticated()
  @ApiOperation({
    summary: 'Public and company holidays of a year (own country unless one is given)',
  })
  async holidays(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(holidayQuerySchema)) query: HolidayQuery,
  ): Promise<Holiday[]> {
    return this.db.tx(async (tx) => {
      let country = query.country ?? null;
      if (!country) {
        const employee = await tx.employee.findFirst({
          where: { userId: actor.userId },
          select: { country: true },
        });
        country = employee?.country ?? (await this.settings.settings(tx)).defaultCountry;
      }
      return this.settings.holidays(tx, country, query.year);
    });
  }

  @Post('holidays')
  @RequirePermission('leave.manage_types_policies')
  @ApiOperation({ summary: 'Add a custom holiday' })
  createHoliday(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createHolidayRequestSchema)) body: CreateHolidayRequest,
  ): Promise<Holiday> {
    return this.settings.create(actor, body);
  }

  @Delete('holidays/:id')
  @HttpCode(204)
  @RequirePermission('leave.manage_types_policies')
  @ApiOperation({ summary: 'Remove a custom holiday' })
  removeHoliday(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
  ): Promise<void> {
    return this.settings.remove(actor, id);
  }

  // ----- balances ------------------------------------------------------------------------------

  @Get('balances')
  @RequirePermission('leave.view_balance')
  @ApiOperation({ summary: 'Yearly balances of yourself or, within your scope, of somebody else' })
  listBalances(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(balanceQuerySchema)) query: BalanceQuery,
  ): Promise<LeaveBalances> {
    return this.balances.list(actor, query);
  }

  @Post('balances/adjustments')
  @RequirePermission('leave.adjust_balance')
  @ApiOperation({ summary: 'Add or subtract leave days on a yearly balance' })
  adjust(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(adjustBalanceRequestSchema)) body: AdjustBalanceRequest,
  ): Promise<LeaveBalance> {
    return this.balances.adjust(actor, body);
  }

  // ----- requests ------------------------------------------------------------------------------

  @Post('requests/preview')
  @HttpCode(200)
  @RequirePermission('leave.request')
  @ApiOperation({ summary: 'Counted days and balance effect of a request, without saving it' })
  preview(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(previewLeaveRequestSchema)) body: PreviewLeaveRequest,
  ): Promise<LeavePreview> {
    return this.requests.preview(actor, body);
  }

  @Post('requests')
  @RequirePermission('leave.request')
  @ApiOperation({ summary: 'Request leave for yourself' })
  create(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createLeaveRequestSchema)) body: CreateLeaveRequest,
  ): Promise<LeaveRequest> {
    return this.requests.create(actor, body);
  }

  @Get('requests')
  @RequirePermission('leave.view')
  @ApiOperation({ summary: 'Leave requests of the people the caller may see' })
  list(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(leaveRequestQuerySchema)) query: LeaveRequestQuery,
  ): Promise<LeaveRequestList> {
    return this.requests.list(actor, query);
  }

  @Post('requests/:id/approve')
  @HttpCode(200)
  @RequirePermission('leave.approve')
  @ApiOperation({ summary: 'Approve a pending request (never your own)' })
  approve(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(decisionRequestSchema)) body: DecisionRequest,
  ): Promise<LeaveRequest> {
    return this.requests.approve(actor, id, body);
  }

  @Post('requests/:id/reject')
  @HttpCode(200)
  @RequirePermission('leave.approve')
  @ApiOperation({ summary: 'Reject a pending request (never your own)' })
  reject(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(decisionRequestSchema)) body: DecisionRequest,
  ): Promise<LeaveRequest> {
    return this.requests.reject(actor, id, body);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @Authenticated()
  @ApiOperation({ summary: 'Cancel your own request, or (as an approver) one of your people' })
  cancel(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(decisionRequestSchema)) body: DecisionRequest,
  ): Promise<LeaveRequest> {
    return this.requests.cancel(actor, id, body);
  }
}
