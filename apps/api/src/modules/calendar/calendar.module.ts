import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module.js';
import { SchedulesModule } from '../schedules/schedules.module.js';
import { CalendarFindTimeService } from './calendar-find-time.service.js';
import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';

@Module({
  imports: [LeaveModule, SchedulesModule],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarFindTimeService],
})
export class CalendarModule {}
