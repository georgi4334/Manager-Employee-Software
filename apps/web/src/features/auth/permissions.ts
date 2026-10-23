import {
  hasPermission,
  type GrantedPermissions,
  type PermissionCode,
  type PermissionScope,
} from '@intime/contracts';
import { useCurrentUser } from './use-auth';

/** One permission, or several of which any one is enough. */
export type PermissionRequirement = PermissionCode | readonly PermissionCode[];

/**
 * Does the signed-in user hold the permission (optionally at least with a scope)? For showing and hiding UI
 * only: the API decides, and refuses what the user may not do.
 */
export function usePermission(
  requirement: PermissionRequirement,
  atLeast?: PermissionScope,
): boolean {
  const { data: user } = useCurrentUser();
  return userHasPermission(
    user?.permissions as GrantedPermissions | undefined,
    requirement,
    atLeast,
  );
}

export function userHasPermission(
  granted: GrantedPermissions | undefined,
  requirement: PermissionRequirement,
  atLeast?: PermissionScope,
): boolean {
  const codes = typeof requirement === 'string' ? [requirement] : requirement;
  return codes.some((code) => hasPermission(granted, code, atLeast));
}
