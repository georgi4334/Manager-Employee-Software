import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';

@Module({
  imports: [AuthModule],
  providers: [TenantProvisioningService],
  exports: [TenantProvisioningService],
})
export class TenantsModule {}
