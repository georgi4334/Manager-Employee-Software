import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RoleGrantService } from './role-grant.service.js';
import { RoleSyncService } from './role-sync.service.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';

@Module({
  imports: [AuthModule],
  providers: [TenantProvisioningService, RoleSyncService, RoleGrantService],
  exports: [TenantProvisioningService, RoleSyncService, RoleGrantService],
})
export class TenantsModule {}
