import { Global, Module } from '@nestjs/common';
import {
  AuthorizationService,
  ORG_RELATIONS,
  SelfOnlyOrgRelations,
} from './authorization.service.js';

@Global()
@Module({
  providers: [AuthorizationService, { provide: ORG_RELATIONS, useClass: SelfOnlyOrgRelations }],
  exports: [AuthorizationService, ORG_RELATIONS],
})
export class AuthorizationModule {}
