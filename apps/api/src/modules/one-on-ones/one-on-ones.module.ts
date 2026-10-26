import { Module } from '@nestjs/common';
import { OneOnOnesController } from './one-on-ones.controller.js';
import { OneOnOnesService } from './one-on-ones.service.js';

@Module({
  controllers: [OneOnOnesController],
  providers: [OneOnOnesService],
  // The offboarding and reporting-line hooks.
  exports: [OneOnOnesService],
})
export class OneOnOnesModule {}
