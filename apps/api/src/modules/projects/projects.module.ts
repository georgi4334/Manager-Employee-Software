import { Module } from '@nestjs/common';
import { AssignmentsService } from './assignments.service.js';
import { ClientsService } from './clients.service.js';
import { MilestonesService } from './milestones.service.js';
import { ProjectAccess } from './project-access.service.js';
import { ClientsController, ProjectsController } from './projects.controller.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { ProjectsService } from './projects.service.js';

@Module({
  controllers: [ClientsController, ProjectsController, TasksController],
  providers: [
    ProjectAccess,
    ClientsService,
    ProjectsService,
    MilestonesService,
    AssignmentsService,
    TasksService,
  ],
  // The offboarding hook of employees.
  exports: [AssignmentsService, ProjectAccess],
})
export class ProjectsModule {}
