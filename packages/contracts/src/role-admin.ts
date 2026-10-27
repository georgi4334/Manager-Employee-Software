import { z } from 'zod';
import {
  PERMISSIONS,
  isValidGrant,
  widerScope,
  type GrantedPermissions,
  type PermissionCode,
} from './permissions.js';
import { PERMISSION_SCOPES, type PermissionScope } from './roles.js';

/** Custom roles (docs/adr/0031-role-editor.md). */
export const MAX_CUSTOM_ROLES = 30;
export const MAX_ROLE_NAME = 60;
export const MAX_ROLE_DESCRIPTION = 200;

export interface Grant {
  code: string;
  scope: PermissionScope;
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'tooLong' })
    .transform((value) => (value === '' ? null : value));

export const grantSchema = z.object({ code: z.string(), scope: z.enum(PERMISSION_SCOPES) });

/** Valid grants only: known code, a scope the permission allows, each code once. */
const grantsSchema = z
  .array(grantSchema)
  .max(PERMISSIONS.length)
  .superRefine((grants, ctx) => {
    const seen = new Set<string>();
    grants.forEach((grant, index) => {
      if (!isValidGrant(grant.code, grant.scope)) {
        ctx.addIssue({ code: 'custom', path: [index], message: 'invalid_grant' });
      }
      if (seen.has(grant.code)) {
        ctx.addIssue({ code: 'custom', path: [index], message: 'duplicate' });
      }
      seen.add(grant.code);
    });
  });

export const roleRequestSchema = z
  .object({
    name: z.string().trim().min(1, { error: 'required' }).max(MAX_ROLE_NAME, { error: 'tooLong' }),
    description: text(MAX_ROLE_DESCRIPTION).optional(),
    grants: grantsSchema,
  })
  .strict();
export type RoleRequest = z.infer<typeof roleRequestSchema>;

export const roleDetailSchema = z.object({
  id: z.uuid(),
  key: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  grants: z.array(grantSchema),
  userCount: z.number().int(),
});
export type RoleDetail = z.infer<typeof roleDetailSchema>;

/**
 * Grants of `requested` that are new or wider than in `current` and that the actor does not hold at that scope or wider:
 * these are the escalations (nobody grants what they do not hold). Unchanged and narrower grants are never escalations.
 */
export function escalations(
  actor: GrantedPermissions,
  current: readonly Grant[],
  requested: readonly Grant[],
): Grant[] {
  const before = new Map(current.map((g) => [g.code, g.scope]));
  return requested.filter((grant) => {
    const had = before.get(grant.code);
    if (had !== undefined && widerScope(had, grant.scope) === had) return false; // same or narrower
    const mine = actor[grant.code as PermissionCode];
    return mine === undefined || widerScope(mine, grant.scope) !== mine;
  });
}

export interface GrantDiff {
  added: Grant[];
  changed: Grant[];
  removed: Grant[];
}

/** What a role edit does to the grants, for the audit log and for deciding whether admin power may be lost. */
export function diffGrants(before: readonly Grant[], after: readonly Grant[]): GrantDiff {
  const was = new Map(before.map((g) => [g.code, g.scope]));
  const now = new Map(after.map((g) => [g.code, g.scope]));
  return {
    added: after.filter((g) => !was.has(g.code)),
    changed: after.filter((g) => was.has(g.code) && was.get(g.code) !== g.scope),
    removed: before.filter((g) => !now.has(g.code)),
  };
}
