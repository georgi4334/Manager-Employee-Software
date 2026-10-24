import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createAssignmentRequestSchema,
  createClientRequestSchema,
  createMilestoneRequestSchema,
  createProjectRequestSchema,
  projectQuerySchema,
  updateAssignmentRequestSchema,
  updateClientRequestSchema,
  updateMilestoneRequestSchema,
  updateProjectRequestSchema,
  type Assignment,
  type Client,
  type ClientList,
  type CreateAssignmentRequest,
  type CreateClientRequest,
  type CreateMilestoneRequest,
  type CreateProjectRequest,
  type Milestone,
  type ProjectDetail,
  type ProjectList,
  type ProjectQuery,
  type UpdateAssignmentRequest,
  type UpdateClientRequest,
  type UpdateMilestoneRequest,
  type UpdateProjectRequest,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AssignmentsService } from './assignments.service.js';
import { ClientsService } from './clients.service.js';
import { MilestonesService } from './milestones.service.js';
import { ProjectsService } from './projects.service.js';

const id = new ZodValidationPipe(z.uuid());

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequirePermission('client.view')
  @ApiOperation({ summary: 'Clients with their number of projects' })
  list(): Promise<ClientList> {
    return this.clients.list();
  }

  @Post()
  @RequirePermission('client.manage')
  @ApiOperation({ summary: 'Add a client' })
  create(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createClientRequestSchema)) body: CreateClientRequest,
  ): Promise<Client> {
    return this.clients.create(actor, body);
  }

  @Patch(':id')
  @RequirePermission('client.manage')
  @ApiOperation({ summary: 'Change or archive a client' })
  update(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) clientId: string,
    @Body(new ZodValidationPipe(updateClientRequestSchema)) body: UpdateClientRequest,
  ): Promise<Client> {
    return this.clients.update(actor, clientId, body);
  }
}

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly milestones: MilestonesService,
    private readonly assignments: AssignmentsService,
  ) {}

  @Get()
  @RequirePermission('project.view')
  @ApiOperation({ summary: 'Projects you may see' })
  list(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(projectQuerySchema)) query: ProjectQuery,
  ): Promise<ProjectList> {
    return this.projects.list(actor, query);
  }

  @Get(':id')
  @RequirePermission('project.view')
  @ApiOperation({ summary: 'A project with milestones and staffing' })
  get(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) projectId: string,
  ): Promise<ProjectDetail> {
    return this.projects.get(actor, projectId);
  }

  @Post()
  @RequirePermission('project.manage')
  @ApiOperation({ summary: 'Create a project (managers lead the projects they create)' })
  create(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createProjectRequestSchema)) body: CreateProjectRequest,
  ): Promise<ProjectDetail> {
    return this.projects.create(actor, body);
  }

  @Patch(':id')
  @RequirePermission('project.manage')
  @ApiOperation({ summary: 'Change a project' })
  update(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) projectId: string,
    @Body(new ZodValidationPipe(updateProjectRequestSchema)) body: UpdateProjectRequest,
  ): Promise<ProjectDetail> {
    return this.projects.update(actor, projectId, body);
  }

  @Post(':id/milestones')
  @RequirePermission('project.manage')
  @ApiOperation({ summary: 'Add a milestone' })
  addMilestone(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) projectId: string,
    @Body(new ZodValidationPipe(createMilestoneRequestSchema)) body: CreateMilestoneRequest,
  ): Promise<Milestone> {
    return this.milestones.create(actor, projectId, body);
  }

  @Patch(':id/milestones/:milestoneId')
  @RequirePermission('project.manage')
  @ApiOperation({ summary: 'Change or finish a milestone' })
  updateMilestone(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) projectId: string,
    @Param('milestoneId', id) milestoneId: string,
    @Body(new ZodValidationPipe(updateMilestoneRequestSchema)) body: UpdateMilestoneRequest,
  ): Promise<Milestone> {
    return this.milestones.update(actor, projectId, milestoneId, body);
  }

  @Delete(':id/milestones/:milestoneId')
  @HttpCode(204)
  @RequirePermission('project.manage')
  @ApiOperation({ summary: 'Delete a milestone' })
  removeMilestone(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) projectId: string,
    @Param('milestoneId', id) milestoneId: string,
  ): Promise<void> {
    return this.milestones.remove(actor, projectId, milestoneId);
  }

  @Post(':id/assignments')
  @RequirePermission('assignment.manage')
  @ApiOperation({ summary: 'Put somebody on the project' })
  addAssignment(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) projectId: string,
    @Body(new ZodValidationPipe(createAssignmentRequestSchema)) body: CreateAssignmentRequest,
  ): Promise<Assignment> {
    return this.assignments.create(actor, projectId, body);
  }

  @Patch(':id/assignments/:assignmentId')
  @RequirePermission('assignment.manage')
  @ApiOperation({ summary: 'Change role, allocation or period of an assignment' })
  updateAssignment(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) projectId: string,
    @Param('assignmentId', id) assignmentId: string,
    @Body(new ZodValidationPipe(updateAssignmentRequestSchema)) body: UpdateAssignmentRequest,
  ): Promise<Assignment> {
    return this.assignments.update(actor, projectId, assignmentId, body);
  }

  @Delete(':id/assignments/:assignmentId')
  @HttpCode(204)
  @RequirePermission('assignment.manage')
  @ApiOperation({ summary: 'Take somebody off the project' })
  removeAssignment(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', id) projectId: string,
    @Param('assignmentId', id) assignmentId: string,
  ): Promise<void> {
    return this.assignments.remove(actor, projectId, assignmentId);
  }
}
