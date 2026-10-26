import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  workScheduleRequestSchema,
  type WorkScheduleRequest,
  type WorkSchedules,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { SchedulesService } from './schedules.service.js';

@ApiTags('employees')
@Controller('employees/:employeeId/schedule')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  @RequirePermission('employee.view_profile_full')
  @ApiOperation({ summary: 'Working hours of a person, with upcoming and past changes' })
  get(
    @CurrentAuth() actor: RequestAuth,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ): Promise<WorkSchedules> {
    return this.schedules.get(actor, employeeId);
  }

  @Put()
  @RequirePermission('employee.manage_schedule')
  @ApiOperation({ summary: 'Set the weekly working hours from a date on' })
  set(
    @CurrentAuth() actor: RequestAuth,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(workScheduleRequestSchema)) body: WorkScheduleRequest,
  ): Promise<WorkSchedules> {
    return this.schedules.set(actor, employeeId, body);
  }

  @Delete(':scheduleId')
  @RequirePermission('employee.manage_schedule')
  @ApiOperation({ summary: 'Remove one schedule change' })
  remove(
    @CurrentAuth() actor: RequestAuth,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
  ): Promise<WorkSchedules> {
    return this.schedules.remove(actor, employeeId, scheduleId);
  }
}
