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
  checklistItemDoneRequestSchema,
  checklistQuerySchema,
  createChecklistItemRequestSchema,
  startChecklistRequestSchema,
  templateRequestSchema,
  updateChecklistItemRequestSchema,
  type ChecklistDetail,
  type ChecklistItemDoneRequest,
  type ChecklistList,
  type ChecklistQuery,
  type ChecklistTemplate,
  type ChecklistTemplateList,
  type CreateChecklistItemRequest,
  type MyChecklistItemList,
  type StartChecklistRequest,
  type TemplateRequest,
  type UpdateChecklistItemRequest,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { Authenticated, CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ChecklistsService } from './checklists.service.js';

const id = new ZodValidationPipe(z.uuid());

/**
 * Onboarding and offboarding checklists (docs/adr/0040-onboarding-checklists.md). Reading and ticking are
 * `@Authenticated()`: assignees may see and tick their items whatever their grants; the service checks scopes.
 */
@ApiTags('checklists')
@Controller()
export class ChecklistsController {
  constructor(private readonly checklists: ChecklistsService) {}

  // ----- templates -----------------------------------------------------------------------------

  @Get('checklist-templates')
  @Authenticated()
  @ApiOperation({ summary: 'Checklist templates (to manage or to start a checklist from)' })
  listTemplates(@CurrentAuth() actor: RequestAuth): Promise<ChecklistTemplateList> {
    return this.checklists.listTemplates(actor);
  }

  @Get('checklist-templates/:id')
  @Authenticated()
  @ApiOperation({ summary: 'One checklist template' })
  getTemplate(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) templateId: string,
  ): Promise<ChecklistTemplate> {
    return this.checklists.getTemplate(actor, templateId);
  }

  @Post('checklist-templates')
  @RequirePermission('checklist.manage_templates')
  @ApiOperation({ summary: 'Create a checklist template' })
  createTemplate(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(templateRequestSchema)) body: TemplateRequest,
  ): Promise<ChecklistTemplate> {
    return this.checklists.createTemplate(actor, body);
  }

  @Put('checklist-templates/:id')
  @RequirePermission('checklist.manage_templates')
  @ApiOperation({ summary: 'Replace a checklist template and its items' })
  updateTemplate(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) templateId: string,
    @Body(new ZodValidationPipe(templateRequestSchema)) body: TemplateRequest,
  ): Promise<ChecklistTemplate> {
    return this.checklists.updateTemplate(actor, templateId, body);
  }

  @Delete('checklist-templates/:id')
  @HttpCode(204)
  @RequirePermission('checklist.manage_templates')
  @ApiOperation({ summary: 'Delete a checklist template (running checklists keep their items)' })
  deleteTemplate(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) templateId: string,
  ): Promise<void> {
    return this.checklists.deleteTemplate(actor, templateId);
  }

  // ----- checklists ----------------------------------------------------------------------------

  @Get('checklists')
  @Authenticated()
  @ApiOperation({ summary: 'Checklists you may see' })
  list(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(checklistQuerySchema)) query: ChecklistQuery,
  ): Promise<ChecklistList> {
    return this.checklists.list(actor, query);
  }

  @Get('checklists/my-items')
  @Authenticated()
  @ApiOperation({ summary: 'Open checklist items waiting for you' })
  mine(@CurrentAuth() actor: RequestAuth): Promise<MyChecklistItemList> {
    return this.checklists.mine(actor);
  }

  @Get('checklists/:id')
  @Authenticated()
  @ApiOperation({ summary: 'One checklist with its items' })
  get(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) checklistId: string,
  ): Promise<ChecklistDetail> {
    return this.checklists.get(actor, checklistId);
  }

  @Post('checklists')
  @RequirePermission('checklist.manage')
  @ApiOperation({ summary: 'Start a checklist for a person from a template' })
  start(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(startChecklistRequestSchema)) body: StartChecklistRequest,
  ): Promise<ChecklistDetail> {
    return this.checklists.start(actor, body);
  }

  @Post('checklists/:id/cancel')
  @HttpCode(200)
  @RequirePermission('checklist.manage')
  @ApiOperation({ summary: 'Cancel an open checklist' })
  cancel(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) checklistId: string,
  ): Promise<ChecklistDetail> {
    return this.checklists.cancel(actor, checklistId);
  }

  @Post('checklists/:id/items')
  @RequirePermission('checklist.manage')
  @ApiOperation({ summary: 'Add an item to a checklist' })
  addItem(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) checklistId: string,
    @Body(new ZodValidationPipe(createChecklistItemRequestSchema)) body: CreateChecklistItemRequest,
  ): Promise<ChecklistDetail> {
    return this.checklists.addItem(actor, checklistId, body);
  }

  @Patch('checklists/:id/items/:itemId')
  @RequirePermission('checklist.manage')
  @ApiOperation({ summary: 'Change an item (title, due date, responsible, assignee)' })
  updateItem(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) checklistId: string,
    @Param('itemId', id) itemId: string,
    @Body(new ZodValidationPipe(updateChecklistItemRequestSchema)) body: UpdateChecklistItemRequest,
  ): Promise<ChecklistDetail> {
    return this.checklists.updateItem(actor, checklistId, itemId, body);
  }

  @Delete('checklists/:id/items/:itemId')
  @RequirePermission('checklist.manage')
  @ApiOperation({ summary: 'Remove an item' })
  deleteItem(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) checklistId: string,
    @Param('itemId', id) itemId: string,
  ): Promise<ChecklistDetail> {
    return this.checklists.deleteItem(actor, checklistId, itemId);
  }

  @Put('checklists/:id/items/:itemId/done')
  @Authenticated()
  @ApiOperation({
    summary: 'Tick or untick an item (assignee, HR group or manager of the checklist)',
  })
  tick(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) checklistId: string,
    @Param('itemId', id) itemId: string,
    @Body(new ZodValidationPipe(checklistItemDoneRequestSchema)) body: ChecklistItemDoneRequest,
  ): Promise<ChecklistDetail> {
    return this.checklists.tick(actor, checklistId, itemId, body.done);
  }
}
