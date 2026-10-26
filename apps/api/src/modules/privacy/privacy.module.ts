import { Module } from '@nestjs/common';
import { ErasureService } from './erasure.service.js';
import { PrivacyController } from './privacy.controller.js';
import { PrivacyService } from './privacy.service.js';
import { RetentionRunner } from './retention.runner.js';
import { RetentionService } from './retention.service.js';

@Module({
  controllers: [PrivacyController],
  providers: [PrivacyService, ErasureService, RetentionService, RetentionRunner],
  exports: [RetentionRunner],
})
export class PrivacyModule {}
