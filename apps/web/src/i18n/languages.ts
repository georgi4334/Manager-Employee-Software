export const LANGUAGES = ['en', 'de', 'bg'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';
export const LANGUAGE_STORAGE_KEY = 'intime.language';

/** Native names, so a user can always find their language regardless of the current UI language. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  de: 'Deutsch',
  bg: 'Български',
};

/** Region-specific Intl locales for dates and numbers (EU conventions: day-first dates). */
export const INTL_LOCALES: Record<Language, string> = {
  en: 'en-GB',
  de: 'de-DE',
  bg: 'bg-BG',
};

export const NAMESPACES = [
  'common',
  'nav',
  'dashboard',
  'errors',
  'auth',
  'notifications',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Stored choice wins; otherwise the first browser language we support (de-AT -> de); otherwise English. */
export function detectLanguage(stored: unknown, browserLanguages: readonly string[]): Language {
  if (isLanguage(stored)) return stored;
  for (const tag of browserLanguages) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}
