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
  createSkillCategoryRequestSchema,
  createSkillRequestSchema,
  setRatingRequestSchema,
  skillPeopleQuerySchema,
  updateSkillCategoryRequestSchema,
  updateSkillRequestSchema,
  type CreateSkillCategoryRequest,
  type CreateSkillRequest,
  type PersonSkills,
  type SetRatingRequest,
  type SkillCatalog,
  type SkillPeople,
  type SkillPeopleQuery,
  type UpdateSkillCategoryRequest,
  type UpdateSkillRequest,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { SkillsService } from './skills.service.js';

const id = new ZodValidationPipe(z.uuid());

@ApiTags('skills')
@Controller('skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get('catalog')
  @RequirePermission('skill.view')
  @ApiOperation({ summary: 'Categories and skills' })
  catalog(@CurrentAuth() actor: RequestAuth): Promise<SkillCatalog> {
    return this.skills.catalog(actor);
  }

  @Post('categories')
  @RequirePermission('skill.manage_catalog')
  @ApiOperation({ summary: 'Add a category' })
  createCategory(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createSkillCategoryRequestSchema)) body: CreateSkillCategoryRequest,
  ): Promise<SkillCatalog> {
    return this.skills.createCategory(actor, body);
  }

  @Patch('categories/:id')
  @RequirePermission('skill.manage_catalog')
  @ApiOperation({ summary: 'Rename a category' })
  updateCategory(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) categoryId: string,
    @Body(new ZodValidationPipe(updateSkillCategoryRequestSchema)) body: UpdateSkillCategoryRequest,
  ): Promise<SkillCatalog> {
    return this.skills.updateCategory(actor, categoryId, body);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  @RequirePermission('skill.manage_catalog')
  @ApiOperation({ summary: 'Delete an empty category' })
  async deleteCategory(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) categoryId: string,
  ): Promise<void> {
    await this.skills.deleteCategory(actor, categoryId);
  }

  @Post()
  @RequirePermission('skill.manage_catalog')
  @ApiOperation({ summary: 'Add a skill' })
  createSkill(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createSkillRequestSchema)) body: CreateSkillRequest,
  ): Promise<SkillCatalog> {
    return this.skills.createSkill(actor, body);
  }

  @Get('people')
  @RequirePermission('skill.view')
  @ApiOperation({ summary: 'People you may see with their skill levels' })
  people(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(skillPeopleQuerySchema)) query: SkillPeopleQuery,
  ): Promise<SkillPeople> {
    return this.skills.people(actor, query);
  }

  @Get('employees/:employeeId')
  @RequirePermission('skill.view')
  @ApiOperation({ summary: 'The skill levels of one person' })
  employee(
    @CurrentAuth() actor: RequestAuth,
    @Param('employeeId', id) employeeId: string,
  ): Promise<PersonSkills> {
    return this.skills.employee(actor, employeeId);
  }

  @Put('employees/:employeeId/ratings/:skillId')
  @RequirePermission('skill.update')
  @ApiOperation({ summary: 'Set a skill level' })
  setRating(
    @CurrentAuth() actor: RequestAuth,
    @Param('employeeId', id) employeeId: string,
    @Param('skillId', id) skillId: string,
    @Body(new ZodValidationPipe(setRatingRequestSchema)) body: SetRatingRequest,
  ): Promise<PersonSkills> {
    return this.skills.setRating(actor, employeeId, skillId, body.level);
  }

  @Delete('employees/:employeeId/ratings/:skillId')
  @RequirePermission('skill.update')
  @ApiOperation({ summary: 'Remove a skill level' })
  removeRating(
    @CurrentAuth() actor: RequestAuth,
    @Param('employeeId', id) employeeId: string,
    @Param('skillId', id) skillId: string,
  ): Promise<PersonSkills> {
    return this.skills.removeRating(actor, employeeId, skillId);
  }

  @Patch(':id')
  @RequirePermission('skill.manage_catalog')
  @ApiOperation({ summary: 'Change, move or archive a skill' })
  updateSkill(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) skillId: string,
    @Body(new ZodValidationPipe(updateSkillRequestSchema)) body: UpdateSkillRequest,
  ): Promise<SkillCatalog> {
    return this.skills.updateSkill(actor, skillId, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('skill.manage_catalog')
  @ApiOperation({ summary: 'Delete a skill nobody has rated' })
  async deleteSkill(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) skillId: string,
  ): Promise<void> {
    await this.skills.deleteSkill(actor, skillId);
  }
}
