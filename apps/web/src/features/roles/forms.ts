import {
  MAX_ROLE_DESCRIPTION,
  MAX_ROLE_NAME,
  PERMISSIONS,
  getPermission,
  isPermissionCode,
  widerScope,
  type Grant,
  type GrantedPermissions,
  type PermissionCode,
  type PermissionScope,
  type RoleDetail,
  type RoleRequest,
} from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
export const roleFormSchema = z.object({
  name: z.string().trim().min(1, { error: 'required' }).max(MAX_ROLE_NAME, { error: 'tooLong' }),
  description: z.string().trim().max(MAX_ROLE_DESCRIPTION, { error: 'tooLong' }),
  /** Permission code to scope; '' (or missing) = no access. */
  grants: z.record(z.string(), z.string()),
});
export type RoleFormValues = z.input<typeof roleFormSchema>;

export const emptyRole = (): RoleFormValues => ({ name: '', description: '', grants: {} });

export const grantsToMap = (grants: readonly Grant[]): Record<string, string> =>
  Object.fromEntries(grants.map((g) => [g.code, g.scope]));

export const valuesOf = (role: RoleDetail): RoleFormValues => ({
  name: role.name,
  description: role.description ?? '',
  grants: grantsToMap(role.grants),
});

export const toRequest = (v: RoleFormValues): RoleRequest => ({
  name: v.name.trim(),
  ...(v.description.trim() ? { description: v.description.trim() } : {}),
  grants: PERMISSIONS.flatMap((p) => {
    const scope = v.grants[p.code];
    return scope && (p.scopes as readonly string[]).includes(scope)
      ? [{ code: p.code, scope: scope as PermissionScope }]
      : [];
  }),
});

/** Can the signed-in user put this permission at this scope into a role? (The server decides; this is for the UI.) */
export function mayGrant(
  mine: GrantedPermissions | undefined,
  code: PermissionCode,
  scope: PermissionScope,
): boolean {
  const have = mine?.[code];
  return have !== undefined && widerScope(have, scope) === have;
}

/** The scopes of a permission the user may choose, widest last. */
export function scopesFor(code: PermissionCode): readonly PermissionScope[] {
  return getPermission(code).scopes;
}

/** A copy of another role's grants, limited to what the user may grant (so a copy never fails on escalation). */
export function copyGrants(
  from: readonly Grant[],
  mine: GrantedPermissions | undefined,
): Record<string, string> {
  return grantsToMap(
    from.filter((g) => isPermissionCode(g.code) && mayGrant(mine, g.code, g.scope)),
  );
}
