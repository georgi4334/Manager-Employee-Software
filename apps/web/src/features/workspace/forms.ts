import {
  isTimeZone,
  WORKSPACE_LANGUAGES,
  WORKSPACE_NAME_MAX,
  type UpdateWorkspaceSettingsRequest,
  type WorkspaceSettings,
} from '@intime/contracts';
import { z } from 'zod';

/** Messages are keys of `errors:validation`; rules mirror @intime/contracts (see forms.test.ts). */
export const workspaceFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'required' })
    .max(WORKSPACE_NAME_MAX, { error: 'tooLong' }),
  timeZone: z.string().refine(isTimeZone, { error: 'invalidTimeZone' }),
  language: z.enum(WORKSPACE_LANGUAGES),
  /** Empty = no default country. */
  country: z.union([z.literal(''), z.string().regex(/^[A-Z]{2}$/, { error: 'invalidCountry' })]),
});
export type WorkspaceFormValues = z.input<typeof workspaceFormSchema>;

export const formValues = (s: WorkspaceSettings): WorkspaceFormValues => ({
  name: s.name,
  timeZone: s.timeZone,
  language: s.language,
  country: s.country ?? '',
});

/** Only what changed is sent, so a save never rewrites a value somebody else just changed. */
export function changedRequest(
  values: WorkspaceFormValues,
  current: WorkspaceSettings,
): UpdateWorkspaceSettingsRequest | null {
  const name = values.name.trim();
  const country = values.country === '' ? null : values.country;
  const body: UpdateWorkspaceSettingsRequest = {
    ...(name !== current.name ? { name } : {}),
    ...(values.timeZone !== current.timeZone ? { timeZone: values.timeZone } : {}),
    ...(values.language !== current.language ? { language: values.language } : {}),
    ...(country !== current.country ? { country } : {}),
  };
  return Object.keys(body).length > 0 ? body : null;
}
