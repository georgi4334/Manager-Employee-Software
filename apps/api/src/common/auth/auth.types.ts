import type { GrantedPermissions, RoleSummary } from '@intime/contracts';
import type { Request } from 'express';

export interface RequestAuth {
  userId: string;
  tenantId: string;
  sessionId: string;
  roles: RoleSummary[];
  /** Effective permissions, read from the database for this request. */
  permissions: GrantedPermissions;
}

export interface AuthenticatedRequest extends Request {
  auth?: RequestAuth;
}
