import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { GoalsModule } from '../goals/goals.module.js';
import { LeaveModule } from '../leave/leave.module.js';
import { OneOnOnesModule } from '../one-on-ones/one-on-ones.module.js';
import { TimeModule } from '../time/time.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { UsersModule } from '../users/users.module.js';
import { EmployeesController } from './employees.controller.js';
import { EmployeesService } from './employees.service.js';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    OrganizationModule,
    ProjectsModule,
    TimeModule,
    GoalsModule,
    OneOnOnesModule,
    LeaveModule,
  ],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
