import type { PermissionScope } from '@intime/contracts';
import type { ReactNode } from 'react';
import { usePermission, type PermissionRequirement } from './permissions';

interface CanProps {
  permission: PermissionRequirement;
  /** Require at least this scope (e.g. "team"). */
  atLeast?: PermissionScope;
  /** Shown instead when the user lacks the permission. Nothing by default. */
  fallback?: ReactNode;
  children: ReactNode;
}

/** Renders its children only for users who hold the permission. Cosmetic: the server is the authority. */
export function Can({ permission, atLeast, fallback = null, children }: CanProps) {
  return usePermission(permission, atLeast) ? <>{children}</> : <>{fallback}</>;
}
