import { Module } from '@nestjs/common';
import { WorkspaceSettingsController } from './workspace-settings.controller.js';
import { WorkspaceSettingsService } from './workspace-settings.service.js';

@Module({
  controllers: [WorkspaceSettingsController],
  providers: [WorkspaceSettingsService],
})
export class WorkspaceModule {}
