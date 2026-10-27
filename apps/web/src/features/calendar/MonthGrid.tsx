import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { formatDay } from '@/shared/lib/format';
import { eachDay, monthOf, rangeFor } from './dates';
import { KIND_DOT } from './ItemRow';
import { isWeekend } from './time-grid';
import { KIND_BLOCK } from './TimeGrid';
import { itemsOnDay, type CalendarItem } from './items';

interface MonthGridProps {
  anchor: string;
  selected: string;
  today: string;
  items: readonly CalendarItem[];
  onSelect: (date: string) => void;
  /** Wider screens show event titles in the days, phones only colored dots. */
  wide?: boolean;
}

/** Six whole weeks starting on Monday; each day shows up to three colored markers. */
export function MonthGrid({
  anchor,
  selected,
  today,
  items,
  onSelect,
  wide = false,
}: MonthGridProps) {
  const { t, i18n } = useTranslation('calendar');
  const language = i18n.resolvedLanguage ?? 'en';
  const { from, to } = rangeFor('month', anchor);
  const days = eachDay(from, to);
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));

  return (
    <div role="grid" aria-label={formatDay(anchor, language, { month: 'long', year: 'numeric' })}>
      <div role="row" className="grid grid-cols-7 pb-1 text-center text-xs text-muted-foreground">
        {days.slice(0, 7).map((date) => (
          <span key={date} role="columnheader" className={cn(isWeekend(date) && 'text-foreground')}>
            {formatDay(date, language, { weekday: 'short' })}
          </span>
        ))}
      </div>
      <div className="space-y-px overflow-hidden rounded-xl border border-border bg-border">
        {weeks.map((week) => (
          <div key={week[0]} role="row" className="grid grid-cols-7 gap-px">
            {week.map((date) => {
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
                    'flex min-h-14 flex-col gap-1 bg-surface p-1 text-sm transition-colors hover:bg-secondary',
                    wide ? 'min-h-24 items-stretch' : 'items-center',
                    isWeekend(date) && 'bg-surface-muted',
                    monthOf(date) !== monthOf(anchor) && 'text-muted-foreground',
                    date === selected && 'font-semibold shadow-[inset_0_0_0_2px_var(--primary)]',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-7 place-items-center rounded-full',
                      wide && 'self-end',
                      date === today && 'bg-primary font-semibold text-primary-foreground',
                    )}
                  >
                    {Number(date.slice(8))}
                  </span>
                  {wide ? (
                    <span className="space-y-0.5 text-left" aria-hidden="true">
                      {list.slice(0, 2).map((item) => (
                        <span
                          key={item.key}
                          className={cn(
                            'block truncate rounded border-l-2 px-1 text-[0.6875rem] font-normal text-foreground',
                            KIND_BLOCK[item.kind],
                          )}
                        >
                          {item.startTime && !item.allDay && item.startDate === date
                            ? `${item.startTime} `
                            : ''}
                          {item.title}
                        </span>
                      ))}
                      {list.length > 2 && (
                        <span className="block px-1 text-[0.6875rem] font-normal text-muted-foreground">
                          {t('month.more', { count: list.length - 2 })}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="flex gap-0.5" aria-hidden="true">
                      {kinds.map((kind) => (
                        <span key={kind} className={cn('size-1.5 rounded-full', KIND_DOT[kind])} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
