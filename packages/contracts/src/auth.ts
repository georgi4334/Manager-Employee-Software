import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const USER_STATUSES = ['invited', 'active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Emails are compared lower-cased and trimmed everywhere (also enforced by a database constraint). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const emailSchema = z.string().trim().max(254).pipe(z.email()).transform(normalizeEmail);

export const workspaceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'invalid_workspace');

/** Length only: the "must not contain the email" rule needs the email, see passwordProblems(). */
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** Extra password rules that need context. Returns problem codes (empty = ok). */
export function passwordProblems(password: string, email: string): string[] {
  const problems: string[] = [];
  const localPart = normalizeEmail(email).split('@')[0] ?? '';
  if (localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    problems.push('password_contains_email');
  }
  if (new Set(password).size < 4) problems.push('password_too_repetitive');
  return problems;
}

export const loginRequestSchema = z.object({
  email: emailSchema,
  // Not passwordSchema: old passwords may predate policy changes; only cap the length.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  workspace: workspaceSlugSchema.optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'invalid_token');

export const inspectInvitationRequestSchema = z.object({ token: tokenSchema });

export const acceptInvitationRequestSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
  workspace: workspaceSlugSchema.optional(),
});

export const resetPasswordRequestSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});

export const workspaceSchema = z.object({ slug: z.string(), name: z.string() });
export type Workspace = z.infer<typeof workspaceSchema>;

export const currentUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  locale: z.string().nullable(),
  timezone: z.string().nullable(),
  workspace: workspaceSchema,
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

export const invitationInfoSchema = z.object({ email: z.string(), workspace: workspaceSchema });
export type InvitationInfo = z.infer<typeof invitationInfoSchema>;
