import { Module } from '@nestjs/common';
import { AssignmentsService } from './assignments.service.js';
import { ClientsService } from './clients.service.js';
import { MilestonesService } from './milestones.service.js';
import { ProjectAccess } from './project-access.service.js';
import { ClientsController, ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  controllers: [ClientsController, ProjectsController],
  providers: [
    ProjectAccess,
    ClientsService,
    ProjectsService,
    MilestonesService,
    AssignmentsService,
  ],
  // The offboarding hook of employees.
  exports: [AssignmentsService],
})
export class ProjectsModule {}
