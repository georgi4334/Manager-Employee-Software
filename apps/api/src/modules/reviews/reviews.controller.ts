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
  calibrationRequestSchema,
  createCompetencyRequestSchema,
  createReviewCycleRequestSchema,
  managerReviewRequestSchema,
  reopenRequestSchema,
  reviewListQuerySchema,
  selfReviewRequestSchema,
  updateCompetencyRequestSchema,
  updateReviewCycleRequestSchema,
  type CalibrationRequest,
  type CreateCompetencyRequest,
  type CreateReviewCycleRequest,
  type ManagerReviewRequest,
  type ReopenRequest,
  type ReviewCycle,
  type ReviewCycleList,
  type ReviewDetail,
  type ReviewList,
  type ReviewListQuery,
  type SelfReviewRequest,
  type UpdateCompetencyRequest,
  type UpdateReviewCycleRequest,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ReviewsService } from './reviews.service.js';

const id = new ZodValidationPipe(z.uuid());

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  // ----- cycles --------------------------------------------------------------------------------

  @Get('cycles')
  @RequirePermission('review.view')
  @ApiOperation({ summary: 'Review cycles you take part in (HR: all)' })
  cycles(@CurrentAuth() actor: RequestAuth): Promise<ReviewCycleList> {
    return this.reviews.listCycles(actor);
  }

  @Post('cycles')
  @RequirePermission('review.manage_cycles')
  @ApiOperation({ summary: 'Create a review cycle (draft)' })
  createCycle(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createReviewCycleRequestSchema)) body: CreateReviewCycleRequest,
  ): Promise<ReviewCycle> {
    return this.reviews.createCycle(actor, body);
  }

  @Get('cycles/:id')
  @RequirePermission('review.view')
  @ApiOperation({ summary: 'One review cycle with its competencies' })
  cycle(@CurrentAuth() actor: RequestAuth, @Param('id', id) cycleId: string): Promise<ReviewCycle> {
    return this.reviews.getCycle(actor, cycleId);
  }

  @Patch('cycles/:id')
  @RequirePermission('review.manage_cycles')
  @ApiOperation({ summary: 'Change the name or dates of a draft cycle' })
  updateCycle(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) cycleId: string,
    @Body(new ZodValidationPipe(updateReviewCycleRequestSchema)) body: UpdateReviewCycleRequest,
  ): Promise<ReviewCycle> {
    return this.reviews.updateCycle(actor, cycleId, body);
  }

  @Delete('cycles/:id')
  @HttpCode(204)
  @RequirePermission('review.manage_cycles')
  @ApiOperation({ summary: 'Delete a draft cycle' })
  async deleteCycle(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) cycleId: string,
  ): Promise<void> {
    await this.reviews.deleteCycle(actor, cycleId);
  }

  @Post('cycles/:id/competencies')
  @RequirePermission('review.manage_cycles')
  @ApiOperation({ summary: 'Add a competency to a draft cycle' })
  addCompetency(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) cycleId: string,
    @Body(new ZodValidationPipe(createCompetencyRequestSchema)) body: CreateCompetencyRequest,
  ): Promise<ReviewCycle> {
    return this.reviews.addCompetency(actor, cycleId, body);
  }

  @Patch('cycles/:id/competencies/:competencyId')
  @RequirePermission('review.manage_cycles')
  @ApiOperation({ summary: 'Change a competency of a draft cycle' })
  updateCompetency(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) cycleId: string,
    @Param('competencyId', id) competencyId: string,
    @Body(new ZodValidationPipe(updateCompetencyRequestSchema)) body: UpdateCompetencyRequest,
  ): Promise<ReviewCycle> {
    return this.reviews.updateCompetency(actor, cycleId, competencyId, body);
  }

  @Delete('cycles/:id/competencies/:competencyId')
  @RequirePermission('review.manage_cycles')
  @ApiOperation({ summary: 'Remove a competency from a draft cycle' })
  removeCompetency(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) cycleId: string,
    @Param('competencyId', id) competencyId: string,
  ): Promise<ReviewCycle> {
    return this.reviews.removeCompetency(actor, cycleId, competencyId);
  }

  @Post('cycles/:id/open')
  @HttpCode(200)
  @RequirePermission('review.manage_cycles')
  @ApiOperation({ summary: 'Open the cycle: one review for every active employee' })
  open(@CurrentAuth() actor: RequestAuth, @Param('id', id) cycleId: string): Promise<ReviewCycle> {
    return this.reviews.moveCycle(actor, cycleId, 'open');
  }

  @Post('cycles/:id/calibrate')
  @HttpCode(200)
  @RequirePermission('review.manage_cycles')
  @ApiOperation({ summary: 'Stop writing and start the calibration' })
  startCalibration(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) cycleId: string,
  ): Promise<ReviewCycle> {
    return this.reviews.moveCycle(actor, cycleId, 'calibration');
  }

  @Post('cycles/:id/close')
  @HttpCode(200)
  @RequirePermission('review.manage_cycles')
  @ApiOperation({ summary: 'Close the cycle and release the results' })
  close(@CurrentAuth() actor: RequestAuth, @Param('id', id) cycleId: string): Promise<ReviewCycle> {
    return this.reviews.moveCycle(actor, cycleId, 'closed');
  }

  // ----- reviews -------------------------------------------------------------------------------

  @Get()
  @RequirePermission('review.view')
  @ApiOperation({ summary: 'Reviews: yours, your team’s, or all' })
  list(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(reviewListQuerySchema)) query: ReviewListQuery,
  ): Promise<ReviewList> {
    return this.reviews.list(actor, query);
  }

  @Get(':id')
  @RequirePermission('review.view')
  @ApiOperation({ summary: 'One review, as far as you may read it' })
  get(@CurrentAuth() actor: RequestAuth, @Param('id', id) reviewId: string): Promise<ReviewDetail> {
    return this.reviews.get(actor, reviewId);
  }

  @Put(':id/self')
  @RequirePermission('review.write_self')
  @ApiOperation({ summary: 'Save your self-review (draft)' })
  saveSelf(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) reviewId: string,
    @Body(new ZodValidationPipe(selfReviewRequestSchema)) body: SelfReviewRequest,
  ): Promise<ReviewDetail> {
    return this.reviews.saveSelf(actor, reviewId, body);
  }

  @Post(':id/self/submit')
  @HttpCode(200)
  @RequirePermission('review.write_self')
  @ApiOperation({ summary: 'Submit your self-review' })
  submitSelf(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) reviewId: string,
  ): Promise<ReviewDetail> {
    return this.reviews.submitSelf(actor, reviewId);
  }

  @Put(':id/manager')
  @RequirePermission('review.write_for_report')
  @ApiOperation({ summary: 'Save the manager review (draft)' })
  saveManager(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) reviewId: string,
    @Body(new ZodValidationPipe(managerReviewRequestSchema)) body: ManagerReviewRequest,
  ): Promise<ReviewDetail> {
    return this.reviews.saveManager(actor, reviewId, body);
  }

  @Post(':id/manager/submit')
  @HttpCode(200)
  @RequirePermission('review.write_for_report')
  @ApiOperation({ summary: 'Submit the manager review' })
  submitManager(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) reviewId: string,
  ): Promise<ReviewDetail> {
    return this.reviews.submitManager(actor, reviewId);
  }

  @Put(':id/calibration')
  @RequirePermission('review.calibrate')
  @ApiOperation({ summary: 'Set or clear the calibrated rating' })
  calibrate(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) reviewId: string,
    @Body(new ZodValidationPipe(calibrationRequestSchema)) body: CalibrationRequest,
  ): Promise<ReviewDetail> {
    return this.reviews.calibrate(actor, reviewId, body);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermission('review.calibrate')
  @ApiOperation({ summary: 'Reopen a submitted part so it can be corrected' })
  reopen(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) reviewId: string,
    @Body(new ZodValidationPipe(reopenRequestSchema)) body: ReopenRequest,
  ): Promise<ReviewDetail> {
    return this.reviews.reopen(actor, reviewId, body);
  }
}
