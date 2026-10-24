import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createEventRequestSchema,
  eventQuerySchema,
  updateEventRequestSchema,
  type CalendarEvent,
  type CalendarEventList,
  type CreateEventRequest,
  type EventQuery,
  type UpdateEventRequest,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CalendarService } from './calendar.service.js';

const idParam = new ZodValidationPipe(z.uuid());

// Every role holds calendar.manage_own; the service decides per event (scope and team).
@ApiTags('calendar')
@Controller('calendar/events')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RequirePermission('calendar.manage_own')
  @ApiOperation({ summary: 'Events you may see that overlap a period (at most 93 days)' })
  list(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(eventQuerySchema)) query: EventQuery,
  ): Promise<CalendarEventList> {
    return this.calendar.list(actor, query);
  }

  @Post()
  @RequirePermission('calendar.manage_own')
  @ApiOperation({ summary: 'Create a personal, team or company event' })
  create(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createEventRequestSchema)) body: CreateEventRequest,
  ): Promise<CalendarEvent> {
    return this.calendar.create(actor, body);
  }

  @Patch(':id')
  @RequirePermission('calendar.manage_own')
  @ApiOperation({ summary: 'Change an event you may manage' })
  update(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(updateEventRequestSchema)) body: UpdateEventRequest,
  ): Promise<CalendarEvent> {
    return this.calendar.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('calendar.manage_own')
  @ApiOperation({ summary: 'Delete an event you may manage' })
  remove(@CurrentAuth() actor: RequestAuth, @Param('id', idParam) id: string): Promise<void> {
    return this.calendar.remove(actor, id);
  }
}
