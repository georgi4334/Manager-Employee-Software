import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { formatDate, formatDay } from '@/shared/lib/format';
import type { CalendarItem, ItemKind } from './items';
import { allDayOn, DAY_MINUTES, isWeekend, layoutDay } from './time-grid';

const HOUR_PX = 48;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export const KIND_BLOCK: Record<ItemKind, string> = {
  personal: 'border-primary bg-primary/15',
  team: 'border-info bg-info/15',
  company: 'border-success bg-success/15',
  leave: 'border-warning bg-warning/15',
  holiday: 'border-accent-foreground bg-accent',
};

interface TimeGridProps {
  days: string[];
  items: readonly CalendarItem[];
  today: string;
  /** Minutes after midnight now, in the workspace time zone. */
  now: number;
  selected: string;
  onSelect: (date: string) => void;
}

/**
 * Hours down, days across. The header buttons choose the day whose details show below; the
 * grid itself is a picture of the same items (aria-hidden), the list below is the accessible one.
 */
export function TimeGrid({ days, items, today, now, selected, onSelect }: TimeGridProps) {
  const { t, i18n } = useTranslation('calendar');
  const language = i18n.resolvedLanguage ?? 'en';
  const body = useRef<HTMLDivElement>(null);
  const showsToday = days.includes(today);
  const columns = { gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` };
  const clock = (minutes: number) =>
    formatDate(Date.UTC(2024, 0, 1, 0, minutes), language, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });

  // Open at the current time on today's week, else at the start of a working day.
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    const focus = showsToday ? now : 8 * 60;
    element.scrollTop = Math.max(0, (focus / 60) * HOUR_PX - 2 * HOUR_PX);
    // Only when the shown days change, not every time the clock ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(), showsToday]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="grid border-b border-border" style={columns}>
        <span />
        {days.map((date) => {
          const isToday = date === today;
          return (
            <button
              key={date}
              type="button"
              aria-pressed={date === selected}
              aria-label={`${formatDay(date, language, { dateStyle: 'full' })}${isToday ? ` · ${t('nav.today')}` : ''}`}
              onClick={() => onSelect(date)}
              className={cn(
                'flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 transition-colors hover:bg-secondary',
                isWeekend(date) && 'bg-surface-muted',
                date === selected && !isToday && 'shadow-[inset_0_-2px_0_var(--primary)]',
              )}
            >
              <span className="text-xs text-muted-foreground">
                {formatDay(date, language, { weekday: 'short' })}
              </span>
              <span
                className={cn(
                  'grid min-w-8 place-items-center rounded-lg px-1.5 text-lg font-semibold leading-8',
                  isToday && 'bg-primary text-primary-foreground',
                )}
              >
                {Number(date.slice(8))}
              </span>
            </button>
          );
        })}
      </div>

      <div aria-hidden="true">
        <div className="grid border-b border-border" style={columns}>
          <span className="self-center px-1 text-right text-[0.6875rem] text-muted-foreground">
            {t('day.allDay')}
          </span>
          {days.map((date) => {
            const list = allDayOn(items, date);
            return (
              <div
                key={date}
                className={cn(
                  'min-h-8 space-y-0.5 border-l border-border p-0.5',
                  isWeekend(date) && 'bg-surface-muted',
                )}
              >
                {list.slice(0, 2).map((item) => (
                  <p
                    key={item.key}
                    className={cn(
                      'truncate rounded border-l-2 px-1 text-[0.6875rem] text-foreground',
                      KIND_BLOCK[item.kind],
                    )}
                  >
                    {item.who ? `${item.who} · ` : ''}
                    {item.title}
                  </p>
                ))}
                {list.length > 2 && (
                  <p className="px-1 text-[0.6875rem] text-muted-foreground">
                    {t('month.more', { count: list.length - 2 })}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div ref={body} className="scrollbar-subtle max-h-[34rem] overflow-y-auto">
          <div className="relative grid" style={{ ...columns, height: 24 * HOUR_PX }}>
            <div className="relative">
              {HOURS.slice(1).map((h) => (
                <span
                  key={h}
                  className="absolute right-1.5 -translate-y-1/2 text-[0.6875rem] text-muted-foreground"
                  style={{ top: h * HOUR_PX }}
                >
                  {clock(h * 60)}
                </span>
              ))}
              {showsToday && (
                <span
                  className="absolute right-1 z-10 -translate-y-1/2 rounded bg-surface px-0.5 text-[0.6875rem] font-semibold text-danger"
                  style={{ top: (now / 60) * HOUR_PX }}
                >
                  {clock(now)}
                </span>
              )}
            </div>
            {days.map((date) => (
              <div
                key={date}
                onClick={() => onSelect(date)}
                className={cn(
                  'relative border-l border-border',
                  isWeekend(date) && 'bg-surface-muted',
                )}
              >
                {HOURS.slice(1).map((h) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-border/70"
                    style={{ top: h * HOUR_PX }}
                  />
                ))}
                {layoutDay(items, date).map((segment) => (
                  <div
                    key={segment.item.key}
                    className={cn(
                      'absolute overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-xs text-foreground shadow-card',
                      KIND_BLOCK[segment.item.kind],
                    )}
                    style={{
                      top: (segment.start / 60) * HOUR_PX + 1,
                      height: Math.max(((segment.end - segment.start) / 60) * HOUR_PX - 2, 18),
                      left: `calc(${(segment.lane / segment.lanes) * 100}% + 2px)`,
                      width: `calc(${100 / segment.lanes}% - 4px)`,
                    }}
                  >
                    <p className="truncate font-medium">{segment.item.title}</p>
                    {segment.end - segment.start >= 45 && (
                      <p className="truncate text-muted-foreground">
                        {clock(segment.start)} – {clock(Math.min(segment.end, DAY_MINUTES))}
                      </p>
                    )}
                  </div>
                ))}
                {date === today && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-danger"
                    style={{ top: (now / 60) * HOUR_PX }}
                  >
                    <span className="absolute -left-1 -top-[3px] size-2 rounded-full bg-danger" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
