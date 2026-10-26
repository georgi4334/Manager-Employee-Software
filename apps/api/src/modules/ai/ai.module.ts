import { Module } from '@nestjs/common';
import { CapacityModule } from '../capacity/capacity.module.js';
import { GoalsModule } from '../goals/goals.module.js';
import { LeaveModule } from '../leave/leave.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { AiToolsService } from './ai-tools.service.js';
import { AiProviderClient, HttpAiProviderClient } from './ai-provider.client.js';

@Module({
  imports: [LeaveModule, ProjectsModule, GoalsModule, CapacityModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiToolsService,
    { provide: AiProviderClient, useClass: HttpAiProviderClient },
  ],
})
export class AiModule {}
