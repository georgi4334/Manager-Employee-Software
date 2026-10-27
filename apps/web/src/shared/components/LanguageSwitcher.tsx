import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, LANGUAGE_NAMES, changeLanguage, type Language } from '@/i18n';
import { isLanguage } from '@/i18n/languages';
import { cn } from '@/shared/lib/cn';

/** The language select. The label is hidden by default (signed-out pages) and visible in the account drawer. */
export function LanguageSwitcher({ showLabel = false }: { showLabel?: boolean }) {
  const { t, i18n } = useTranslation('common');
  const current = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en';
  const id = useId();

  return (
    <div className={cn('flex', showLabel ? 'flex-col gap-1.5' : 'items-center')}>
      <label htmlFor={id} className={showLabel ? 'text-sm font-medium' : 'sr-only'}>
        {t('language')}
      </label>
      <select
        id={id}
        value={current}
        onChange={(event) => {
          const value = event.target.value;
          if (isLanguage(value)) void changeLanguage(value as Language);
        }}
        className={cn(
          'min-h-11 rounded-md border border-border bg-surface px-2 text-sm text-foreground',
          showLabel && 'w-full px-3',
        )}
      >
        {LANGUAGES.map((language) => (
          <option key={language} value={language} lang={language}>
            {LANGUAGE_NAMES[language]}
          </option>
        ))}
      </select>
    </div>
  );
}
