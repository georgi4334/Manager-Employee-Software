import { z } from 'zod';
import { emailSchema, USER_STATUSES } from './auth.js';

export const MAX_ROLES_PER_USER = 10;

const roleIdsSchema = z.array(z.uuid()).min(1).max(MAX_ROLES_PER_USER);

export const inviteUserRequestSchema = z.object({
  email: emailSchema,
  /** Defaults to the Employee role. Any other role also needs the admin.role.assign permission. */
  roleIds: roleIdsSchema.optional(),
});
export type InviteUserRequest = z.infer<typeof inviteUserRequestSchema>;

export const setUserRolesRequestSchema = z.object({ roleIds: roleIdsSchema });
export type SetUserRolesRequest = z.infer<typeof setUserRolesRequestSchema>;

export const roleListItemSchema = z.object({
  id: z.uuid(),
  key: z.string().nullable(),
  name: z.string(),
  isSystem: z.boolean(),
  description: z.string().nullable(),
  permissionCount: z.number().int(),
  userCount: z.number().int(),
  /** The role it sits under in the tree (ADR 0036, display only); null = a root. */
  parentId: z.uuid().nullable(),
  /** Modules its grants cover, in catalog order. */
  modules: z.array(z.string()),
});
export type RoleListItem = z.infer<typeof roleListItemSchema>;

export const userSummarySchema = z.object({
  id: z.uuid(),
  email: z.string(),
  status: z.enum(USER_STATUSES),
  roles: z.array(roleListItemSchema.pick({ id: true, key: true, name: true })),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;
