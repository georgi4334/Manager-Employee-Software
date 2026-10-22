import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  normalizeEmail,
  passwordProblems,
} from '@intime/contracts';
import type { FieldError } from 'react-hook-form';
import { z } from 'zod';

/**
 * Form schemas. Messages are not text but keys of the `errors:validation` translations, so every
 * message is shown in the user's language. The rules mirror the API's schemas (@intime/contracts);
 * forms.test.ts checks that data accepted here is also accepted by the API schemas.
 */
const email = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(254, { error: 'tooLong' })
  .pipe(z.email({ error: 'email' }))
  .transform(normalizeEmail);

const requiredText = z.string().min(1, { error: 'required' });

const newPassword = z
  .string()
  // abort: an empty field says "required" only, not also "too short".
  .min(1, { error: 'required', abort: true })
  .min(PASSWORD_MIN_LENGTH, { error: 'passwordMin' })
  .max(PASSWORD_MAX_LENGTH, { error: 'passwordMax' });

export const loginFormSchema = z.object({ email, password: requiredText });
export type LoginFormValues = z.input<typeof loginFormSchema>;

export const forgotFormSchema = z.object({ email });
export type ForgotFormValues = z.input<typeof forgotFormSchema>;

export function passwordFormSchema(emailForContext?: () => string) {
  return z.object({ password: newPassword, confirm: requiredText }).superRefine((value, ctx) => {
    if (value.password !== value.confirm) {
      ctx.addIssue({ code: 'custom', path: ['confirm'], message: 'passwordsDontMatch' });
    }
    const address = emailForContext?.();
    if (address && value.password.length >= PASSWORD_MIN_LENGTH) {
      for (const problem of passwordProblems(value.password, address)) {
        ctx.addIssue({ code: 'custom', path: ['password'], message: problem });
      }
    }
  });
}
export type PasswordFormValues = { password: string; confirm: string };

export const workspaceFieldSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, { error: 'invalid_workspace' });

/** Key inside the `errors:validation` namespace for a field error produced by the schemas above. */
export function validationKey(error: FieldError | undefined): string | undefined {
  return error?.message || undefined;
}
