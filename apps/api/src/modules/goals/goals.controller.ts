import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createGoalRequestSchema,
  createKeyResultRequestSchema,
  goalCheckInRequestSchema,
  goalQuerySchema,
  updateGoalRequestSchema,
  updateKeyResultRequestSchema,
  type CreateGoalRequest,
  type CreateKeyResultRequest,
  type GoalCheckInRequest,
  type GoalDetail,
  type GoalList,
  type GoalQuery,
  type GoalTeams,
  type UpdateGoalRequest,
  type UpdateKeyResultRequest,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { Authenticated, CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { GoalsService } from './goals.service.js';

const id = new ZodValidationPipe(z.uuid());

// Writes depend on the scope of the goal (personal, team or company), so the service checks the matching
// manage permission; the permission guard would require all of them.
@ApiTags('goals')
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  @RequirePermission('goal.view')
  @ApiOperation({ summary: 'Goals you may see' })
  list(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(goalQuerySchema)) query: GoalQuery,
  ): Promise<GoalList> {
    return this.goals.list(actor, query);
  }

  @Get('teams')
  @Authenticated()
  @ApiOperation({ summary: 'Teams you may set team goals for' })
  teams(@CurrentAuth() actor: RequestAuth): Promise<GoalTeams> {
    return this.goals.teams(actor);
  }

  @Get(':id')
  @RequirePermission('goal.view')
  @ApiOperation({ summary: 'One goal with its key results, check-ins and aligned goals' })
  get(@CurrentAuth() actor: RequestAuth, @Param('id', id) goalId: string): Promise<GoalDetail> {
    return this.goals.get(actor, goalId);
  }

  @Post()
  @Authenticated()
  @ApiOperation({ summary: 'Set a personal, team or company goal' })
  create(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createGoalRequestSchema)) body: CreateGoalRequest,
  ): Promise<GoalDetail> {
    return this.goals.create(actor, body);
  }

  @Patch(':id')
  @Authenticated()
  @ApiOperation({ summary: 'Change a goal' })
  update(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) goalId: string,
    @Body(new ZodValidationPipe(updateGoalRequestSchema)) body: UpdateGoalRequest,
  ): Promise<GoalDetail> {
    return this.goals.update(actor, goalId, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Authenticated()
  @ApiOperation({ summary: 'Delete a goal that nothing is aligned to' })
  remove(@CurrentAuth() actor: RequestAuth, @Param('id', id) goalId: string): Promise<void> {
    return this.goals.remove(actor, goalId);
  }

  @Post(':id/key-results')
  @Authenticated()
  @ApiOperation({ summary: 'Add a key result' })
  addKeyResult(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) goalId: string,
    @Body(new ZodValidationPipe(createKeyResultRequestSchema)) body: CreateKeyResultRequest,
  ): Promise<GoalDetail> {
    return this.goals.addKeyResult(actor, goalId, body);
  }

  @Patch(':id/key-results/:keyResultId')
  @Authenticated()
  @ApiOperation({ summary: 'Change a key result, e.g. its current value' })
  updateKeyResult(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) goalId: string,
    @Param('keyResultId', id) keyResultId: string,
    @Body(new ZodValidationPipe(updateKeyResultRequestSchema)) body: UpdateKeyResultRequest,
  ): Promise<GoalDetail> {
    return this.goals.updateKeyResult(actor, goalId, keyResultId, body);
  }

  @Delete(':id/key-results/:keyResultId')
  @Authenticated()
  @ApiOperation({ summary: 'Remove a key result' })
  removeKeyResult(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) goalId: string,
    @Param('keyResultId', id) keyResultId: string,
  ): Promise<GoalDetail> {
    return this.goals.removeKeyResult(actor, goalId, keyResultId);
  }

  @Post(':id/updates')
  @Authenticated()
  @ApiOperation({ summary: 'Check in: record the current progress with an optional comment' })
  checkIn(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) goalId: string,
    @Body(new ZodValidationPipe(goalCheckInRequestSchema)) body: GoalCheckInRequest,
  ): Promise<GoalDetail> {
    return this.goals.checkIn(actor, goalId, body);
  }
}
