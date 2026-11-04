import { z } from 'zod';

/** Workspace settings (docs/adr/0043-workspace-settings.md). */
export const WORKSPACE_LANGUAGES = ['en', 'de', 'bg'] as const;
export type WorkspaceLanguage = (typeof WORKSPACE_LANGUAGES)[number];

/** Countries the app has holidays for; the page offers these (any other stored code stays selectable). */
export const WORKSPACE_COUNTRIES = ['BG', 'DE', 'GB'] as const;

export const WORKSPACE_NAME_MAX = 100;

/** An IANA time zone the runtime knows, e.g. "Europe/Sofia", or "UTC". Offsets like "+02:00" are refused. */
export function isTimeZone(value: string): boolean {
  if (value !== 'UTC' && !/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The zones to choose from: what the runtime lists, plus UTC; the current one is always kept. */
export function timeZoneOptions(current?: string): string[] {
  const listed =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const all = new Set(['UTC', ...listed, ...(current ? [current] : [])]);
  return [...all].sort((a, b) => (a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b)));
}

const name = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(WORKSPACE_NAME_MAX, { error: 'tooLong' });
const timeZone = z.string().trim().refine(isTimeZone, { error: 'invalidTimeZone' });
/** Same rule as the leave settings' default country (the same column). */
const country = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, { error: 'invalidCountry' });

export const updateWorkspaceSettingsRequestSchema = z
  .object({
    name: name.optional(),
    timeZone: timeZone.optional(),
    language: z.enum(WORKSPACE_LANGUAGES).optional(),
    country: country.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: 'required' });
export type UpdateWorkspaceSettingsRequest = z.infer<typeof updateWorkspaceSettingsRequestSchema>;

export const workspaceSettingsSchema = z.object({
  name: z.string(),
  /** Fixed: sign-in links and emails use it. */
  slug: z.string(),
  timeZone: z.string(),
  language: z.enum(WORKSPACE_LANGUAGES),
  country: z.string().nullable(),
  /** May change the settings (admin.tenant.settings at scope all). */
  canEdit: z.boolean(),
});
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;
