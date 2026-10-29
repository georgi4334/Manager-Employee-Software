import { Bell, Clock, MapPin, Repeat } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { formatDay } from '@/shared/lib/format';
import type { CalendarItem } from './items';
import { KIND_ACCENT, KIND_DOT } from './kinds';

interface ItemRowProps {
  item: CalendarItem;
  date: string;
  /** Opens the details (and, where allowed, edit and delete) of the item. */
  onOpen: (item: CalendarItem, date: string) => void;
}

/** One item on one day, as a card. The whole card opens the item's dialog. */
export function ItemRow({ item, date, onOpen }: ItemRowProps) {
  const { t, i18n } = useTranslation('calendar');
  const language = i18n.resolvedLanguage ?? 'en';
  const event = item.event;
  const accent = KIND_ACCENT[item.kind];

  const first = item.startDate === date;
  const last = item.endDate === date;
  const when = item.allDay
    ? t('day.allDay')
    : first && last
      ? t('day.range', { start: item.startTime, end: item.endTime })
      : first
        ? t('day.from', { start: item.startTime })
        : last
          ? t('day.until', { end: item.endTime })
          : t('day.allDay');
  const span =
    item.startDate !== item.endDate
      ? t('day.span', {
          from: formatDay(item.startDate, language),
          to: formatDay(item.endDate, language),
        })
      : null;

  return (
    <li
      className={cn(
        'group relative rounded-xl glass border-l-4 p-4 transition-[background-color,box-shadow] duration-200 glass-hover',
        accent.edge,
      )}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-lg font-semibold leading-snug">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => onOpen(item, date)}
              // The button covers the whole card, so a click anywhere opens it.
              className="break-words text-left after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
            >
              {item.who ? `${item.who} · ` : ''}
              {item.title}
              {item.pending && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({t('day.pending')})
                </span>
              )}
            </button>
          </p>
          <ul
            aria-label={t('day.details')}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground"
          >
            <li className="inline-flex items-center gap-1.5">
              <span
                className={cn('inline-block size-2 rounded-full', KIND_DOT[item.kind])}
                aria-hidden="true"
              />
              {t(`layers.${item.kind}`)}
            </li>
            {event?.team && <li>{event.team.name}</li>}
            {event?.recurrence && (
              <li className="inline-flex items-center gap-1.5">
                <Repeat className="size-3.5" aria-hidden="true" />
                {t(`repeat.summary.${event.recurrence.freq}`, { count: event.recurrence.interval })}
              </li>
            )}
            {event?.reminderMinutes && (
              <li className="inline-flex items-center gap-1.5">
                <Bell className="size-3.5" aria-hidden="true" />
                {t(`reminder.shown.${event.reminderMinutes === 1440 ? 1440 : 60}`)}
              </li>
            )}
            {event?.location && (
              <li className="inline-flex items-center gap-1.5 text-foreground">
                <MapPin className="size-3.5" aria-hidden="true" />
                {event.location}
              </li>
            )}
          </ul>
          {span && <p className="text-sm text-muted-foreground">{span}</p>}
          {event?.description && (
            <p className="line-clamp-2 whitespace-pre-line break-words text-sm text-foreground/80">
              {event.description}
            </p>
          )}
        </div>
        <div className="shrink-0 space-y-1 text-right">
          <p className={cn('text-3xl font-semibold leading-none tabular-nums', accent.text)}>
            {formatDay(date, language, { day: 'numeric' })}
          </p>
          <p className={cn('text-xs font-bold uppercase tracking-wider', accent.text)}>
            {formatDay(date, language, { month: 'long' })}
          </p>
          <p className="inline-flex max-w-32 items-center justify-end gap-1 text-xs text-muted-foreground">
            <Clock className="size-3 shrink-0" aria-hidden="true" />
            {when}
          </p>
        </div>
      </div>
    </li>
  );
}
