import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module.js';
import { SchedulesModule } from '../schedules/schedules.module.js';
import { CalendarFindTimeService } from './calendar-find-time.service.js';
import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';
import { HolidayFeedClient, OpenHolidaysClient } from './holiday-feed.client.js';
import { PublicHolidaysService } from './public-holidays.service.js';

@Module({
  imports: [LeaveModule, SchedulesModule],
  controllers: [CalendarController],
  providers: [
    CalendarService,
    CalendarFindTimeService,
    PublicHolidaysService,
    { provide: HolidayFeedClient, useClass: OpenHolidaysClient },
  ],
})
export class CalendarModule {}
