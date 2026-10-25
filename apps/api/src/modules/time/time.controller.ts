import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createTimeEntryRequestSchema,
  startTimerRequestSchema,
  submitTimesheetRequestSchema,
  timesheetQuerySchema,
  updateTimeEntryRequestSchema,
  weekQuerySchema,
  type CreateTimeEntryRequest,
  type StartTimerRequest,
  type SubmitTimesheetRequest,
  type TimeEntry,
  type TimerResponse,
  type Timesheet,
  type TimesheetList,
  type TimesheetQuery,
  type TimeWeek,
  type UpdateTimeEntryRequest,
  type WeekQuery,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { TimeService } from './time.service.js';
import { TimesheetsService } from './timesheets.service.js';

const id = new ZodValidationPipe(z.uuid());

@ApiTags('time')
@Controller('time')
export class TimeController {
  constructor(
    private readonly time: TimeService,
    private readonly sheets: TimesheetsService,
  ) {}

  @Get('timer')
  @RequirePermission('time.log')
  @ApiOperation({ summary: 'Your running timer, if any' })
  timer(@CurrentAuth() actor: RequestAuth): Promise<TimerResponse> {
    return this.time.timer(actor);
  }

  @Post('timer/start')
  @RequirePermission('time.log')
  @ApiOperation({ summary: 'Start the timer on a project (one at a time)' })
  start(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(startTimerRequestSchema)) body: StartTimerRequest,
  ): Promise<TimeEntry> {
    return this.time.startTimer(actor, body);
  }

  @Post('timer/stop')
  @HttpCode(200)
  @RequirePermission('time.log')
  @ApiOperation({ summary: 'Stop the running timer' })
  stop(@CurrentAuth() actor: RequestAuth): Promise<TimeEntry> {
    return this.time.stopTimer(actor);
  }

  @Get('week')
  @RequirePermission('time.log', 'time.view')
  @ApiOperation({ summary: 'One week of time: yours, or a person you may view' })
  week(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(weekQuerySchema)) query: WeekQuery,
  ): Promise<TimeWeek> {
    return this.time.week(actor, query);
  }

  @Post('entries')
  @RequirePermission('time.log')
  @ApiOperation({ summary: 'Log time by hand' })
  create(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createTimeEntryRequestSchema)) body: CreateTimeEntryRequest,
  ): Promise<TimeEntry> {
    return this.time.createEntry(actor, body);
  }

  @Patch('entries/:id')
  @RequirePermission('time.log')
  @ApiOperation({ summary: 'Change one of your entries (week not submitted)' })
  update(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) entryId: string,
    @Body(new ZodValidationPipe(updateTimeEntryRequestSchema)) body: UpdateTimeEntryRequest,
  ): Promise<TimeEntry> {
    return this.time.updateEntry(actor, entryId, body);
  }

  @Delete('entries/:id')
  @HttpCode(204)
  @RequirePermission('time.log')
  @ApiOperation({ summary: 'Delete one of your entries (week not submitted)' })
  remove(@CurrentAuth() actor: RequestAuth, @Param('id', id) entryId: string): Promise<void> {
    return this.time.deleteEntry(actor, entryId);
  }

  @Post('timesheets/submit')
  @HttpCode(200)
  @RequirePermission('timesheet.submit')
  @ApiOperation({ summary: 'Submit one of your weeks for approval' })
  submit(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(submitTimesheetRequestSchema)) body: SubmitTimesheetRequest,
  ): Promise<Timesheet> {
    return this.sheets.submit(actor, body);
  }

  @Get('timesheets')
  @RequirePermission('timesheet.approve')
  @ApiOperation({ summary: 'Timesheets of the people you approve' })
  list(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(timesheetQuerySchema)) query: TimesheetQuery,
  ): Promise<TimesheetList> {
    return this.sheets.list(actor, query);
  }

  @Get('timesheets/:id')
  @RequirePermission('timesheet.approve')
  @ApiOperation({ summary: 'The entries behind a timesheet' })
  detail(@CurrentAuth() actor: RequestAuth, @Param('id', id) sheetId: string): Promise<TimeWeek> {
    return this.sheets.detail(actor, sheetId);
  }

  @Post('timesheets/:id/approve')
  @HttpCode(200)
  @RequirePermission('timesheet.approve')
  @ApiOperation({ summary: 'Approve a submitted timesheet' })
  approve(@CurrentAuth() actor: RequestAuth, @Param('id', id) sheetId: string): Promise<Timesheet> {
    return this.sheets.approve(actor, sheetId);
  }

  @Post('timesheets/:id/reject')
  @HttpCode(200)
  @RequirePermission('timesheet.approve')
  @ApiOperation({ summary: 'Send a submitted timesheet back' })
  reject(@CurrentAuth() actor: RequestAuth, @Param('id', id) sheetId: string): Promise<Timesheet> {
    return this.sheets.reject(actor, sheetId);
  }

  @Post('timesheets/:id/reopen')
  @HttpCode(200)
  @RequirePermission('timesheet.reopen')
  @ApiOperation({ summary: 'Reopen an approved timesheet' })
  reopen(@CurrentAuth() actor: RequestAuth, @Param('id', id) sheetId: string): Promise<Timesheet> {
    return this.sheets.reopen(actor, sheetId);
  }
}
