import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createActionItemRequestSchema,
  createOneOnOneRequestSchema,
  oneOnOneQuerySchema,
  updateActionItemRequestSchema,
  updateOneOnOneRequestSchema,
  type CreateActionItemRequest,
  type CreateOneOnOneRequest,
  type OneOnOneDetail,
  type OneOnOneList,
  type OneOnOnePeople,
  type OneOnOneQuery,
  type UpdateActionItemRequest,
  type UpdateOneOnOneRequest,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { OneOnOnesService } from './one-on-ones.service.js';

const id = new ZodValidationPipe(z.uuid());

// Only the two people of a meeting ever see it: the service looks every meeting up through its participants.
@ApiTags('one-on-ones')
@Controller('one-on-ones')
@RequirePermission('one_on_one.manage')
export class OneOnOnesController {
  constructor(private readonly meetings: OneOnOnesService) {}

  @Get()
  @ApiOperation({ summary: 'Your 1:1 meetings' })
  list(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(oneOnOneQuerySchema)) query: OneOnOneQuery,
  ): Promise<OneOnOneList> {
    return this.meetings.list(actor, query);
  }

  @Get('people')
  @ApiOperation({ summary: 'People you can schedule a 1:1 with' })
  people(@CurrentAuth() actor: RequestAuth): Promise<OneOnOnePeople> {
    return this.meetings.people(actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One meeting with notes and action items' })
  get(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) meetingId: string,
  ): Promise<OneOnOneDetail> {
    return this.meetings.get(actor, meetingId);
  }

  @Post()
  @ApiOperation({ summary: 'Schedule a 1:1' })
  create(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createOneOnOneRequestSchema)) body: CreateOneOnOneRequest,
  ): Promise<OneOnOneDetail> {
    return this.meetings.create(actor, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Reschedule, finish or cancel a 1:1, or write its notes' })
  update(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) meetingId: string,
    @Body(new ZodValidationPipe(updateOneOnOneRequestSchema)) body: UpdateOneOnOneRequest,
  ): Promise<OneOnOneDetail> {
    return this.meetings.update(actor, meetingId, body);
  }

  @Post(':id/action-items')
  @ApiOperation({ summary: 'Add an action item' })
  addItem(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) meetingId: string,
    @Body(new ZodValidationPipe(createActionItemRequestSchema)) body: CreateActionItemRequest,
  ): Promise<OneOnOneDetail> {
    return this.meetings.addActionItem(actor, meetingId, body);
  }

  @Patch(':id/action-items/:itemId')
  @ApiOperation({ summary: 'Change or complete an action item' })
  updateItem(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) meetingId: string,
    @Param('itemId', id) itemId: string,
    @Body(new ZodValidationPipe(updateActionItemRequestSchema)) body: UpdateActionItemRequest,
  ): Promise<OneOnOneDetail> {
    return this.meetings.updateActionItem(actor, meetingId, itemId, body);
  }

  @Delete(':id/action-items/:itemId')
  @ApiOperation({ summary: 'Remove an action item' })
  removeItem(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) meetingId: string,
    @Param('itemId', id) itemId: string,
  ): Promise<OneOnOneDetail> {
    return this.meetings.removeActionItem(actor, meetingId, itemId);
  }
}
