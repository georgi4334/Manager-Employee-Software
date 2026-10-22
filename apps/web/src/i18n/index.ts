import i18n from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LANGUAGE_STORAGE_KEY,
  NAMESPACES,
  detectLanguage,
  isLanguage,
  type Language,
} from './languages';

export { LANGUAGES, LANGUAGE_NAMES, INTL_LOCALES, type Language } from './languages';

function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistLanguage(language: string): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Storage can be blocked; the choice then lasts for this session only.
  }
}

/** Keeps <html lang> in sync so screen readers and browsers pick the right pronunciation/hyphenation. */
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

const loaders = import.meta.glob<{ default: Record<string, unknown> }>('./locales/*/*.json');

/** Production setup: namespaces are lazy-loaded per language, so users only download their own. */
export function initI18n() {
  return i18n
    .use(
      resourcesToBackend(async (language: string, namespace: string) => {
        const load = loaders[`./locales/${language}/${namespace}.json`];
        if (!load) throw new Error(`Missing translation file: ${language}/${namespace}`);
        return (await load()).default;
      }),
    )
    .use(initReactI18next)
    .init({
      lng: detectLanguage(readStoredLanguage(), navigator.languages ?? [navigator.language]),
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: [...LANGUAGES],
      ns: [...NAMESPACES],
      defaultNS: 'common',
      interpolation: { escapeValue: false },
    });
}

export async function changeLanguage(language: Language): Promise<void> {
  if (!isLanguage(language)) return;
  persistLanguage(language);
  await i18n.changeLanguage(language);
}

export { i18n };
