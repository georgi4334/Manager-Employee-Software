import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createEmployeeRequestSchema,
  deactivateEmployeeRequestSchema,
  employeeQuerySchema,
  inviteEmployeeRequestSchema,
  updateEmployeeRequestSchema,
  updateOwnEmployeeRequestSchema,
  type CreateEmployeeRequest,
  type DeactivateEmployeeRequest,
  type Employee,
  type EmployeeList,
  type EmployeeQuery,
  type InviteEmployeeRequest,
  type UpdateEmployeeRequest,
  type UpdateOwnEmployeeRequest,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { Authenticated, CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { EmployeesService } from './employees.service.js';

const idParam = new ZodValidationPipe(z.uuid());

@ApiTags('employees')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermission('employee.view_directory')
  @ApiOperation({ summary: 'Company directory (profile data only where the caller may see it)' })
  list(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(employeeQuerySchema)) query: EmployeeQuery,
  ): Promise<EmployeeList> {
    return this.employees.list(actor, query);
  }

  // Declared before ":id" so "me" is not read as an id.
  @Get('me')
  @Authenticated()
  @ApiOperation({ summary: "The caller's own employee record" })
  me(@CurrentAuth() actor: RequestAuth): Promise<Employee> {
    return this.employees.me(actor);
  }

  @Patch('me')
  @RequirePermission('employee.update_self_basic')
  @ApiOperation({ summary: 'Edit your own phone number' })
  updateOwn(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(updateOwnEmployeeRequestSchema)) body: UpdateOwnEmployeeRequest,
  ): Promise<Employee> {
    return this.employees.updateOwn(actor, body);
  }

  @Get(':id')
  @RequirePermission('employee.view_directory')
  @ApiOperation({ summary: 'One employee' })
  get(@CurrentAuth() actor: RequestAuth, @Param('id', idParam) id: string): Promise<Employee> {
    return this.employees.get(actor, id);
  }

  @Post()
  @RequirePermission('employee.create')
  @ApiOperation({ summary: 'Create an employee; with an email also invites them to sign in' })
  create(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(createEmployeeRequestSchema)) body: CreateEmployeeRequest,
  ): Promise<Employee> {
    return this.employees.create(actor, body);
  }

  @Patch(':id')
  @RequirePermission('employee.update')
  @ApiOperation({ summary: 'Edit an employee' })
  update(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(updateEmployeeRequestSchema)) body: UpdateEmployeeRequest,
  ): Promise<Employee> {
    return this.employees.update(actor, id, body);
  }

  @Post(':id/invitation')
  @HttpCode(200)
  @RequirePermission('admin.user.invite')
  @ApiOperation({ summary: 'Invite (or re-send the invitation to) an employee' })
  invite(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(inviteEmployeeRequestSchema)) body: InviteEmployeeRequest,
  ): Promise<Employee> {
    return this.employees.invite(actor, id, body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('employee.deactivate')
  @ApiOperation({ summary: 'Deactivate an employee and disable their account' })
  deactivate(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodValidationPipe(deactivateEmployeeRequestSchema)) body: DeactivateEmployeeRequest,
  ): Promise<Employee> {
    return this.employees.deactivate(actor, id, body);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('employee.deactivate')
  @ApiOperation({ summary: 'Reactivate an employee and re-enable their account' })
  reactivate(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', idParam) id: string,
  ): Promise<Employee> {
    return this.employees.reactivate(actor, id);
  }
}
