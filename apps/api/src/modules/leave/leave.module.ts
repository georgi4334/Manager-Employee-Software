import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { LeaveBalancesService } from './leave-balances.service.js';
import { LeaveConflictsService } from './leave-conflicts.service.js';
import { LeaveRequestsService } from './leave-requests.service.js';
import { LeaveSettingsService } from './leave-settings.service.js';
import { LeaveTypesService } from './leave-types.service.js';
import { LeaveController } from './leave.controller.js';

@Module({
  imports: [ProjectsModule],
  controllers: [LeaveController],
  providers: [
    LeaveTypesService,
    LeaveSettingsService,
    LeaveBalancesService,
    LeaveRequestsService,
    LeaveConflictsService,
  ],
  exports: [LeaveTypesService, LeaveSettingsService],
})
export class LeaveModule {}
