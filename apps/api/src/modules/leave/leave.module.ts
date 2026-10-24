import { Module } from '@nestjs/common';
import { LeaveBalancesService } from './leave-balances.service.js';
import { LeaveRequestsService } from './leave-requests.service.js';
import { LeaveSettingsService } from './leave-settings.service.js';
import { LeaveTypesService } from './leave-types.service.js';
import { LeaveController } from './leave.controller.js';

@Module({
  controllers: [LeaveController],
  providers: [LeaveTypesService, LeaveSettingsService, LeaveBalancesService, LeaveRequestsService],
  exports: [LeaveTypesService],
})
export class LeaveModule {}
