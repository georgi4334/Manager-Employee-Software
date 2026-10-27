import { SERIES_MODES, type SeriesMode } from '@intime/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

interface SeriesScopeProps {
  value: SeriesMode;
  onChange: (mode: SeriesMode) => void;
}

/** Which part of a repeating event a change or deletion applies to. The server checks the mode. */
export function SeriesScope({ value, onChange }: SeriesScopeProps) {
  const { t } = useTranslation('calendar');
  const name = useId();
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{t('series.legend')}</legend>
      {SERIES_MODES.map((mode) => (
        <label key={mode} className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name={name}
            className="size-5"
            checked={value === mode}
            onChange={() => onChange(mode)}
          />
          {t(`series.${mode}`)}
        </label>
      ))}
    </fieldset>
  );
}
