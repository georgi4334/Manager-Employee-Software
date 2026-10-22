export const SYSTEM_ROLES = ['admin', 'hr', 'manager', 'employee'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const PERMISSION_SCOPES = ['own', 'reports', 'team', 'department', 'all'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export function isSystemRole(value: unknown): value is SystemRole {
  return typeof value === 'string' && (SYSTEM_ROLES as readonly string[]).includes(value);
}
