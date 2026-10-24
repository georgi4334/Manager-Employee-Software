import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE, LANGUAGES, NAMESPACES } from '@/i18n/languages';

// All translation files, loaded eagerly so tests render synchronously. (Vite caches this glob: after adding a
// namespace file, touch this file once so tests see it. Touched for: organization, leave, attendance.)
const files = import.meta.glob<{ default: Record<string, unknown> }>('../i18n/locales/*/*.json', {
  eager: true,
});

const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, module] of Object.entries(files)) {
  const [, language, file] = path.match(/locales\/([^/]+)\/([^/]+)\.json$/) ?? [];
  if (!language || !file) continue;
  (resources[language] ??= {})[file] = module.default;
}

export async function initTestI18n(language: string = DEFAULT_LANGUAGE) {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: [...LANGUAGES],
      ns: [...NAMESPACES],
      defaultNS: 'common',
      interpolation: { escapeValue: false },
      initAsync: false,
    });
  }
  await i18n.changeLanguage(language);
}

export { resources };
