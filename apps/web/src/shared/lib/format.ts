import { INTL_LOCALES, isLanguage, DEFAULT_LANGUAGE } from '@/i18n/languages';

function intlLocale(language: string): string {
  return INTL_LOCALES[isLanguage(language) ? language : DEFAULT_LANGUAGE];
}

/** Locale-aware date, e.g. 21/10/2026 (en), 21.10.2026 (de), 21.10.2026 г. (bg). Invalid dates yield "". */
export function formatDate(
  value: Date | string | number,
  language: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(intlLocale(language), options).format(date);
}

/** A calendar date ("YYYY-MM-DD") shown in the user's language; never shifted by the time zone. */
export function formatDay(
  date: string,
  language: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  return formatDate(`${date}T00:00:00Z`, language, { ...options, timeZone: 'UTC' });
}

export function formatNumber(
  value: number,
  language: string,
  options?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat(intlLocale(language), options).format(value);
}

/** "HR, Manager and Employee" / "HR, Manager und Employee": a list in the language's own style. */
export function formatList(items: readonly string[], language: string): string {
  return new Intl.ListFormat(intlLocale(language), { style: 'long', type: 'conjunction' }).format(
    items,
  );
}
