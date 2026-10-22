import type { Request } from 'express';

export interface RequestAuth {
  userId: string;
  tenantId: string;
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: RequestAuth;
}
