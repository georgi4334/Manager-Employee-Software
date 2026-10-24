import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  checkInRequestSchema,
  checkOutRequestSchema,
  createRecordRequestSchema,
  recordQuerySchema,
  updateRecordRequestSchema,
  type AttendanceRecord,
  type AttendanceRecordList,
  type AttendanceStatus,
  type CheckInRequest,
  type CheckOutRequest,
  type CreateRecordRequest,
  type Presence,
  type RecordQuery,
  type UpdateRecordRequest,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { Authenticated, CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AttendanceService } from './attendance.service.js';

const idParam = new ZodValidationPipe(z.uuid());

@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('status')
  @RequirePermission('attendance.record')
  @ApiOperation({ summary: 'Your open record and today’s records' })
  status(@CurrentAuth() actor: RequestAuth): Promise<AttendanceStatus> {
    return this.attendance.status(actor);
  }

  @Post('check-in')
  @RequirePermission('attendance.record')
  @ApiOperation({ summary: 'Start working now (the server clock decides the time)' })
  checkIn(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(checkInRequestSchema)) body: CheckInRequest,
  ): Promise<AttendanceRecord> {
    return this.attendance.checkIn(actor, body);
  }

  @Post('check-out')
  @HttpCode(200)
  @RequirePermission('attendance.record')
  @ApiOperation({ summary: 'Stop working now, or at an earlier time of your open record' })
  checkOut(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(checkOutRequestSchema)) body: CheckOutRequest,
  ): Promise<AttendanceRecord> {
    return this.attendance.checkOut(actor, body);
  }

  @Post('records')
  @RequirePermission('attendance.record')
  @ApiOperation({
    summary: 'Type in a period (yourself, last 7 days; others with attendance.correct)',
  })
  create(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createRecordRequestSchema)) body: CreateRecordRequest,
  ): Promise<AttendanceRecord> {
    return this.attendance.create(actor, body);
  }

  @Patch('records/:id')
  @Authenticated()
  @ApiOperation({
    summary: 'Change a record: your own of the last 7 days, or one in your correction scope',
  })
  update(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(updateRecordRequestSchema)) body: UpdateRecordRequest,
  ): Promise<AttendanceRecord> {
    return this.attendance.update(actor, id, body);
  }

  @Delete('records/:id')
  @HttpCode(204)
  @Authenticated()
  @ApiOperation({ summary: 'Delete a record (same rules as changing it)' })
  remove(@CurrentAuth() actor: RequestAuth, @Param('id', idParam) id: string): Promise<void> {
    return this.attendance.remove(actor, id);
  }

  @Get('records')
  @RequirePermission('attendance.view')
  @ApiOperation({ summary: 'Records of the people the caller may see, for a period' })
  list(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(recordQuerySchema)) query: RecordQuery,
  ): Promise<AttendanceRecordList> {
    return this.attendance.list(actor, query);
  }

  @Get('today')
  @RequirePermission('attendance.view')
  @ApiOperation({ summary: 'Who is working, done, on leave or not recorded today' })
  today(@CurrentAuth() actor: RequestAuth): Promise<Presence> {
    return this.attendance.presence(actor);
  }
}
