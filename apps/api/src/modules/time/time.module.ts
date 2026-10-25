import { Module } from '@nestjs/common';
import { TimeController } from './time.controller.js';
import { TimeCompareService } from './time-compare.service.js';
import { TimeReportsService } from './time-reports.service.js';
import { TimeService } from './time.service.js';
import { TimesheetsService } from './timesheets.service.js';

@Module({
  controllers: [TimeController],
  providers: [TimeService, TimesheetsService, TimeReportsService, TimeCompareService],
  // The offboarding hook of employees.
  exports: [TimeService],
})
export class TimeModule {}
