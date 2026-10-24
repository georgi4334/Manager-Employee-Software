import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { UsersModule } from '../users/users.module.js';
import { EmployeesController } from './employees.controller.js';
import { EmployeesService } from './employees.service.js';

@Module({
  imports: [AuthModule, UsersModule, OrganizationModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
