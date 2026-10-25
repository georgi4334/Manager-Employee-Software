import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createTaskRequestSchema,
  taskQuerySchema,
  updateTaskRequestSchema,
  type CreateTaskRequest,
  type Task,
  type TaskList,
  type TaskQuery,
  type UpdateTaskRequest,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { TasksService } from './tasks.service.js';

const id = new ZodValidationPipe(z.uuid());

@ApiTags('tasks')
@Controller()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('tasks')
  @RequirePermission('task.view')
  @ApiOperation({ summary: 'Tasks you may see' })
  list(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(taskQuerySchema)) query: TaskQuery,
  ): Promise<TaskList> {
    return this.tasks.list(actor, query);
  }

  @Get('tasks/:id')
  @RequirePermission('task.view')
  @ApiOperation({ summary: 'One task' })
  get(@CurrentAuth() actor: RequestAuth, @Param('id', id) taskId: string): Promise<Task> {
    return this.tasks.get(actor, taskId);
  }

  @Post('projects/:projectId/tasks')
  @RequirePermission('task.manage')
  @ApiOperation({ summary: 'Create a task on a project you lead (HR and Admin: any)' })
  create(
    @CurrentAuth() actor: RequestAuth,
    @Param('projectId', id) projectId: string,
    @Body(new ZodValidationPipe(createTaskRequestSchema)) body: CreateTaskRequest,
  ): Promise<Task> {
    return this.tasks.create(actor, projectId, body);
  }

  @Patch('tasks/:id')
  @RequirePermission('task.manage')
  @ApiOperation({ summary: 'Change a task; the assignee may change only its status' })
  update(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) taskId: string,
    @Body(new ZodValidationPipe(updateTaskRequestSchema)) body: UpdateTaskRequest,
  ): Promise<Task> {
    return this.tasks.update(actor, taskId, body);
  }

  @Delete('tasks/:id')
  @HttpCode(204)
  @RequirePermission('task.manage')
  @ApiOperation({ summary: 'Delete a task' })
  remove(@CurrentAuth() actor: RequestAuth, @Param('id', id) taskId: string): Promise<void> {
    return this.tasks.remove(actor, taskId);
  }
}
