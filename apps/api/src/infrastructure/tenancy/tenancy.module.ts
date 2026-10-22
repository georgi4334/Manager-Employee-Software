import { Global, Module } from '@nestjs/common';
import { DatabaseSafetyService } from './database-safety.service.js';
import { TenantContext } from './tenant-context.js';
import { TenantDb } from './tenant-db.service.js';

@Global()
@Module({
  providers: [TenantContext, TenantDb, DatabaseSafetyService],
  exports: [TenantContext, TenantDb],
})
export class TenancyModule {}
