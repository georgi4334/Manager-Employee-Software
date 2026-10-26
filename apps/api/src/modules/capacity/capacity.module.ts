import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module.js';
import { SchedulesModule } from '../schedules/schedules.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { CapacityController } from './capacity.controller.js';
import { CapacityService } from './capacity.service.js';

@Module({
  imports: [LeaveModule, ProjectsModule, SchedulesModule],
  controllers: [CapacityController],
  providers: [CapacityService],
  exports: [CapacityService],
})
export class CapacityModule {}
