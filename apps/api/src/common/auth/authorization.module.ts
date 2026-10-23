import { Global, Module } from '@nestjs/common';
import { AuthorizationService, ORG_RELATIONS } from './authorization.service.js';
import { DbOrgRelations } from './db-org-relations.js';

@Global()
@Module({
  providers: [AuthorizationService, { provide: ORG_RELATIONS, useClass: DbOrgRelations }],
  exports: [AuthorizationService, ORG_RELATIONS],
})
export class AuthorizationModule {}
