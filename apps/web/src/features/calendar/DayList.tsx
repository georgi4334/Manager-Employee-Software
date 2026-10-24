import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { formatDay } from '@/shared/lib/format';
import { ItemRow } from './ItemRow';
import { itemsOnDay, type CalendarItem } from './items';

interface DayListProps {
  days: string[];
  items: readonly CalendarItem[];
  today: string;
  /** Leave out days without items (agenda). */
  skipEmpty?: boolean;
}

/** Days stacked as sections, each with its items: week, day and agenda views. */
export function DayList({ days, items, today, skipEmpty }: DayListProps) {
  const { t, i18n } = useTranslation('calendar');
  const language = i18n.resolvedLanguage ?? 'en';
  const shown = days
    .map((date) => ({ date, list: itemsOnDay(items, date) }))
    .filter((day) => !skipEmpty || day.list.length > 0);

  if (shown.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface p-4 text-center text-sm text-muted-foreground">
        {t('agenda.empty')}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {shown.map(({ date, list }) => (
        <section
          key={date}
          aria-label={formatDay(date, language, { dateStyle: 'full' })}
          className="space-y-2"
        >
          <h2 className={cn('text-sm font-semibold', date === today && 'text-primary')}>
            {formatDay(date, language, { weekday: 'long', day: 'numeric', month: 'long' })}
            {date === today && ` · ${t('nav.today')}`}
          </h2>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('day.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {list.map((item) => (
                <ItemRow key={item.key} item={item} date={date} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
