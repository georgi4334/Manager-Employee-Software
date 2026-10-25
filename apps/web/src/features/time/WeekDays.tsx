import { formatDuration, type TimeWeek } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { formatDay } from '@/shared/lib/format';
import { EntryRow } from './EntryRow';

/** The seven days of a week with their entries and totals. */
export function WeekDays({ week }: { week: TimeWeek }) {
  const { t, i18n } = useTranslation('time');
  const language = i18n.resolvedLanguage ?? 'en';
  return (
    <ol className="space-y-4" aria-label={t('week.days')}>
      {week.days.map((day) => {
        const entries = week.entries.filter((e) => e.workDate === day.date);
        return (
          <li key={day.date} className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {formatDay(day.date, language, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'short',
                })}
              </h3>
              <span className="text-sm tabular-nums text-muted-foreground">
                {t('hours', { value: formatDuration(day.minutes) })}
              </span>
            </div>
            {entries.length > 0 && (
              <ul className="space-y-2">
                {entries.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} />
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
