import { Module } from '@nestjs/common';
import { ErasureService } from './erasure.service.js';
import { PrivacyController } from './privacy.controller.js';
import { PrivacyService } from './privacy.service.js';

@Module({
  controllers: [PrivacyController],
  providers: [PrivacyService, ErasureService],
})
export class PrivacyModule {}
