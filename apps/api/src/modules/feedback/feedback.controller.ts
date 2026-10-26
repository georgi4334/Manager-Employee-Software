import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createFeedbackRequestSchema,
  feedbackQuerySchema,
  type CreateFeedbackRequest,
  type FeedbackItem,
  type FeedbackList,
  type FeedbackQuery,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { Authenticated, CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { FeedbackService } from './feedback.service.js';

const id = new ZodValidationPipe(z.uuid());

// Reading depends on the box (received, given, reported), so the service checks the matching permission;
// the permission guard would require all of them.
@ApiTags('feedback')
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: 'Feedback you received, gave, or (moderators) that was reported' })
  list(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(feedbackQuerySchema)) query: FeedbackQuery,
  ): Promise<FeedbackList> {
    return this.feedback.list(actor, query);
  }

  @Post()
  @RequirePermission('feedback.give')
  @ApiOperation({ summary: 'Give feedback to a colleague' })
  create(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createFeedbackRequestSchema)) body: CreateFeedbackRequest,
  ): Promise<FeedbackItem> {
    return this.feedback.create(actor, body);
  }

  @Delete(':id')
  @Authenticated()
  @HttpCode(204)
  @ApiOperation({ summary: 'Take back your feedback, or (moderators) remove a reported item' })
  async remove(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) feedbackId: string,
  ): Promise<void> {
    await this.feedback.remove(actor, feedbackId);
  }

  @Post(':id/report')
  @Authenticated()
  @HttpCode(200)
  @ApiOperation({ summary: 'Report feedback you received to a moderator' })
  report(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) feedbackId: string,
  ): Promise<FeedbackItem> {
    return this.feedback.report(actor, feedbackId);
  }

  @Post(':id/keep')
  @Authenticated()
  @HttpCode(200)
  @ApiOperation({ summary: 'Moderators: keep a reported item' })
  keep(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) feedbackId: string,
  ): Promise<FeedbackItem> {
    return this.feedback.keep(actor, feedbackId);
  }
}
