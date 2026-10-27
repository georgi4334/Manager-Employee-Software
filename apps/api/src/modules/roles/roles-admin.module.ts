import { Module } from '@nestjs/common';
import { RolesAdminService } from './roles-admin.service.js';
import { RolesController } from './roles.controller.js';

@Module({
  controllers: [RolesController],
  providers: [RolesAdminService],
})
export class RolesAdminModule {}
