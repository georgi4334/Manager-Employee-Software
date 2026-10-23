import { Global, Module } from '@nestjs/common';
import { ActivityTracker } from './activity-tracker.js';

@Global()
@Module({ providers: [ActivityTracker], exports: [ActivityTracker] })
export class ActivityModule {}
