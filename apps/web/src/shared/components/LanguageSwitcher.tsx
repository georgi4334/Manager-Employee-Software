import { useTranslation } from 'react-i18next';
import { LANGUAGES, LANGUAGE_NAMES, changeLanguage, type Language } from '@/i18n';
import { isLanguage } from '@/i18n/languages';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common');
  const current = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en';

  return (
    <label className="flex items-center">
      <span className="sr-only">{t('language')}</span>
      <select
        value={current}
        onChange={(event) => {
          const value = event.target.value;
          if (isLanguage(value)) void changeLanguage(value as Language);
        }}
        className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
      >
        {LANGUAGES.map((language) => (
          <option key={language} value={language} lang={language}>
            {LANGUAGE_NAMES[language]}
          </option>
        ))}
      </select>
    </label>
  );
}
