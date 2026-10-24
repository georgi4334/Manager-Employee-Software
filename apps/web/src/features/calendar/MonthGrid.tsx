import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { formatDay } from '@/shared/lib/format';
import { eachDay, monthOf, rangeFor } from './dates';
import { KIND_DOT } from './ItemRow';
import { itemsOnDay, type CalendarItem } from './items';

interface MonthGridProps {
  anchor: string;
  selected: string;
  today: string;
  items: readonly CalendarItem[];
  onSelect: (date: string) => void;
}

/** Six whole weeks starting on Monday; each day shows up to three colored markers. */
export function MonthGrid({ anchor, selected, today, items, onSelect }: MonthGridProps) {
  const { t, i18n } = useTranslation('calendar');
  const language = i18n.resolvedLanguage ?? 'en';
  const { from, to } = rangeFor('month', anchor);
  const days = eachDay(from, to);

  return (
    <div role="grid" aria-label={formatDay(anchor, language, { month: 'long', year: 'numeric' })}>
      <div role="row" className="grid grid-cols-7 pb-1 text-center text-xs text-muted-foreground">
        {days.slice(0, 7).map((date) => (
          <span key={date} role="columnheader">
            {formatDay(date, language, { weekday: 'short' })}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border">
        {days.map((date) => {
          const list = itemsOnDay(items, date);
          const kinds = [...new Set(list.map((i) => i.kind))].slice(0, 3);
          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              aria-selected={date === selected}
              aria-label={`${formatDay(date, language, { dateStyle: 'full' })}${list.length ? `, ${t('month.count', { count: list.length })}` : ''}`}
              onClick={() => onSelect(date)}
              className={cn(
                'flex min-h-14 flex-col items-center gap-1 bg-surface p-1 text-sm',
                monthOf(date) !== monthOf(anchor) && 'text-muted-foreground',
                date === selected && 'bg-secondary font-semibold',
                date === today && 'text-primary font-semibold',
              )}
            >
              <span>{Number(date.slice(8))}</span>
              <span className="flex gap-0.5" aria-hidden="true">
                {kinds.map((kind) => (
                  <span key={kind} className={cn('size-1.5 rounded-full', KIND_DOT[kind])} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
