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
  createEventRequestSchema,
  eventQuerySchema,
  findTimeRequestSchema,
  respondRequestSchema,
  seriesScopeQuerySchema,
  updateEventRequestSchema,
  type CalendarEvent,
  type CalendarEventList,
  type CreateEventRequest,
  type EventQuery,
  type FindTimeRequest,
  type FindTimeResponse,
  type RespondRequest,
  type SeriesScopeQuery,
  type UpdateEventRequest,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CalendarFindTimeService } from './calendar-find-time.service.js';
import { CalendarService } from './calendar.service.js';

const idParam = new ZodValidationPipe(z.uuid());

// Every role holds calendar.manage_own; the service decides per event (scope and team).
@ApiTags('calendar')
@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly calendar: CalendarService,
    private readonly findTime: CalendarFindTimeService,
  ) {}

  @Get('events')
  @RequirePermission('calendar.manage_own')
  @ApiOperation({ summary: 'Events you may see that overlap a period (at most 93 days)' })
  list(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(eventQuerySchema)) query: EventQuery,
  ): Promise<CalendarEventList> {
    return this.calendar.list(actor, query);
  }

  @Post('events')
  @RequirePermission('calendar.manage_own')
  @ApiOperation({ summary: 'Create a personal, team or company event' })
  create(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createEventRequestSchema)) body: CreateEventRequest,
  ): Promise<CalendarEvent> {
    return this.calendar.create(actor, body);
  }

  @Patch('events/:id')
  @RequirePermission('calendar.manage_own')
  @ApiOperation({ summary: 'Change an event you may manage' })
  update(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(updateEventRequestSchema)) body: UpdateEventRequest,
    @Query(new ZodValidationPipe(seriesScopeQuerySchema)) scope: SeriesScopeQuery,
  ): Promise<CalendarEvent> {
    return this.calendar.update(actor, id, body, scope);
  }

  @Delete('events/:id')
  @HttpCode(204)
  @RequirePermission('calendar.manage_own')
  @ApiOperation({ summary: 'Delete an event you may manage' })
  remove(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Query(new ZodValidationPipe(seriesScopeQuerySchema)) scope: SeriesScopeQuery,
  ): Promise<void> {
    return this.calendar.remove(actor, id, scope);
  }

  @Put('events/:id/response')
  @RequirePermission('calendar.manage_own')
  @ApiOperation({ summary: 'Answer an invitation (accepted, declined or tentative)' })
  respond(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(respondRequestSchema)) body: RespondRequest,
  ): Promise<CalendarEvent> {
    return this.calendar.respond(actor, id, body);
  }

  @Post('find-time')
  @HttpCode(200)
  @RequirePermission('calendar.manage_own')
  @ApiOperation({ summary: 'Suggest slots where all chosen people are free (slots only)' })
  find(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(findTimeRequestSchema)) body: FindTimeRequest,
  ): Promise<FindTimeResponse> {
    return this.findTime.find(actor, body);
  }
}
