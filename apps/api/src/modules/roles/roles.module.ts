import { Global, Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service.js';
import { SystemRolesService } from './system-roles.service.js';
import { UserRolesService } from './user-roles.service.js';

@Global()
@Module({
  providers: [PermissionsService, SystemRolesService, UserRolesService],
  exports: [PermissionsService, SystemRolesService, UserRolesService],
})
export class RolesModule {}
