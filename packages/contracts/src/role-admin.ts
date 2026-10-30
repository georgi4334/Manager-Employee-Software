import { z } from 'zod';
import {
  PERMISSIONS,
  isValidGrant,
  widerScope,
  type GrantedPermissions,
  type PermissionCode,
} from './permissions.js';
import { PERMISSION_SCOPES, SYSTEM_ROLES, type PermissionScope, type SystemRole } from './roles.js';

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
    /** Where the role sits in the tree (ADR 0036): null = a root; missing = root on create, unchanged on update. */
    parentId: z.uuid().nullable().optional(),
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
  parentId: z.uuid().nullable(),
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

/** Moving a role in the tree (ADR 0036). Display only: the tree never changes what anybody may do. */
export const roleParentRequestSchema = z.object({ parentId: z.uuid().nullable() }).strict();
export type RoleParentRequest = z.infer<typeof roleParentRequestSchema>;

/** Where new workspaces put the system roles; `roles:sync` never moves an existing role. */
export const SYSTEM_ROLE_PARENTS = {
  admin: null,
  hr: 'admin',
  manager: 'hr',
  employee: 'manager',
} as const satisfies Record<SystemRole, SystemRole | null>;

export interface RoleNodeInput {
  id: string;
  parentId: string | null;
}

/**
 * Would putting `id` under `parentId` make a cycle? True when the new parent is the role itself or one of its descendants.
 * A parent chain that is already broken (unknown id) simply ends.
 */
export function wouldCycle(
  roles: readonly RoleNodeInput[],
  id: string,
  parentId: string | null,
): boolean {
  const parentOf = new Map(roles.map((r) => [r.id, r.parentId]));
  const seen = new Set<string>();
  for (let at = parentId; at !== null && at !== undefined; at = parentOf.get(at) ?? null) {
    if (at === id) return true;
    if (seen.has(at)) return true; // an existing loop; never extend it
    seen.add(at);
  }
  return false;
}

/** The ids of every role below `id` (children, their children, ...). */
export function descendantIds(roles: readonly RoleNodeInput[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const r of roles) {
    if (r.parentId === null) continue;
    children.set(r.parentId, [...(children.get(r.parentId) ?? []), r.id]);
  }
  const out = new Set<string>();
  const stack = [...(children.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (out.has(next) || next === id) continue;
    out.add(next);
    stack.push(...(children.get(next) ?? []));
  }
  return out;
}

export interface RoleTreeNode<T> {
  role: T;
  children: RoleTreeNode<T>[];
}

/**
 * Builds the role tree for display. Roots are roles without a parent, or whose parent is unknown; anything caught in a loop is
 * shown as a root too, so every role appears exactly once. Siblings: system roles first (in catalog order), then by name.
 */
export function buildRoleTree<
  T extends RoleNodeInput & { key: string | null; name: string; isSystem: boolean },
>(roles: readonly T[]): RoleTreeNode<T>[] {
  const byId = new Map(roles.map((r) => [r.id, r]));
  const rank = (r: T) =>
    r.isSystem && r.key ? SYSTEM_ROLES.indexOf(r.key as SystemRole) : SYSTEM_ROLES.length;
  const order = (a: RoleTreeNode<T>, b: RoleTreeNode<T>) =>
    rank(a.role) - rank(b.role) || a.role.name.localeCompare(b.role.name);
  const nodes = new Map(roles.map((r) => [r.id, { role: r, children: [] } as RoleTreeNode<T>]));
  const roots: RoleTreeNode<T>[] = [];
  for (const r of roles) {
    const node = nodes.get(r.id)!;
    const parent = r.parentId !== null ? nodes.get(r.parentId) : undefined;
    if (parent && byId.has(r.parentId!) && !wouldCycle(roles, r.id, r.parentId)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sort = (list: RoleTreeNode<T>[]) => {
    list.sort(order);
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}
