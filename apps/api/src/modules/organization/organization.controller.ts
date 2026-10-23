import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  assignmentRequestSchema,
  createDepartmentRequestSchema,
  createTeamRequestSchema,
  setTeamMembersRequestSchema,
  updateDepartmentRequestSchema,
  updateTeamRequestSchema,
  type AssignmentRequest,
  type CreateDepartmentRequest,
  type CreateTeamRequest,
  type Department,
  type OrgChart,
  type SetTeamMembersRequest,
  type Team,
  type UpdateDepartmentRequest,
  type UpdateTeamRequest,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { OrganizationService } from './organization.service.js';

const idParam = new ZodValidationPipe(z.uuid());

@ApiTags('organization')
@Controller('org')
export class OrganizationController {
  constructor(private readonly org: OrganizationService) {}

  @Get('chart')
  @RequirePermission('org.view')
  @ApiOperation({
    summary: 'Active employees with manager and department (flat; the client builds the tree)',
  })
  chart(@CurrentAuth() actor: RequestAuth): Promise<OrgChart> {
    return this.org.chart(actor);
  }

  @Get('departments')
  @RequirePermission('org.view')
  @ApiOperation({ summary: 'Departments with head and counts' })
  departments(@CurrentAuth() actor: RequestAuth): Promise<Department[]> {
    return this.org.listDepartments(actor);
  }

  @Post('departments')
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Create a department' })
  createDepartment(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createDepartmentRequestSchema)) body: CreateDepartmentRequest,
  ): Promise<Department> {
    return this.org.createDepartment(actor, body);
  }

  @Patch('departments/:id')
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Rename, move or change the head of a department' })
  updateDepartment(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(updateDepartmentRequestSchema)) body: UpdateDepartmentRequest,
  ): Promise<Department> {
    return this.org.updateDepartment(actor, id, body);
  }

  @Delete('departments/:id')
  @HttpCode(204)
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Delete an empty department' })
  deleteDepartment(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
  ): Promise<void> {
    return this.org.deleteDepartment(actor, id);
  }

  @Get('teams')
  @RequirePermission('org.view')
  @ApiOperation({ summary: 'Teams with lead and members' })
  teams(@CurrentAuth() actor: RequestAuth): Promise<Team[]> {
    return this.org.listTeams(actor);
  }

  @Post('teams')
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Create a team' })
  createTeam(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createTeamRequestSchema)) body: CreateTeamRequest,
  ): Promise<Team> {
    return this.org.createTeam(actor, body);
  }

  @Patch('teams/:id')
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Rename, move or change the lead of a team' })
  updateTeam(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(updateTeamRequestSchema)) body: UpdateTeamRequest,
  ): Promise<Team> {
    return this.org.updateTeam(actor, id, body);
  }

  @Delete('teams/:id')
  @HttpCode(204)
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Delete a team' })
  deleteTeam(@CurrentAuth() actor: RequestAuth, @Param('id', idParam) id: string): Promise<void> {
    return this.org.deleteTeam(actor, id);
  }

  @Put('teams/:id/members')
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Replace the members of a team' })
  setMembers(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(setTeamMembersRequestSchema)) body: SetTeamMembersRequest,
  ): Promise<Team> {
    return this.org.setTeamMembers(actor, id, body);
  }

  @Put('employees/:id/assignment')
  @HttpCode(204)
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Set the manager and department of an employee' })
  assign(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(assignmentRequestSchema)) body: AssignmentRequest,
  ): Promise<void> {
    return this.org.assign(actor, id, body);
  }
}
