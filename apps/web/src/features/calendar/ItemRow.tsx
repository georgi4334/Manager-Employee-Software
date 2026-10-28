import type { AttendeeResponse, SeriesMode } from '@intime/contracts';
import { Bell, Clock, MapPin, Repeat } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';
import { formatDay } from '@/shared/lib/format';
import { EventForm } from './EventForm';
import { useDeleteEvent, useRespond } from './hooks';
import type { CalendarItem, ItemKind } from './items';
import { SeriesScope } from './SeriesScope';
import { useCalendarErrors } from './use-calendar-errors';

export const KIND_DOT: Record<ItemKind, string> = {
  personal: 'bg-primary',
  team: 'bg-info',
  company: 'bg-success',
  leave: 'bg-warning',
  holiday: 'bg-accent-foreground',
};

/** Edge and date colour per kind (text colours are the AA-checked tokens). */
const KIND_ACCENT: Record<ItemKind, { edge: string; text: string }> = {
  personal: { edge: 'border-l-primary', text: 'text-primary' },
  team: { edge: 'border-l-info', text: 'text-info' },
  company: { edge: 'border-l-success', text: 'text-success' },
  leave: { edge: 'border-l-warning', text: 'text-warning' },
  holiday: { edge: 'border-l-accent-foreground', text: 'text-accent-foreground' },
};

/** One item on one day. Events the server says may be changed offer edit and delete. */
export function ItemRow({ item, date }: { item: CalendarItem; date: string }) {
  const { t, i18n } = useTranslation('calendar');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useCalendarErrors();
  const remove = useDeleteEvent();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [mode, setMode] = useState<SeriesMode>('all');
  const event = item.event;
  const respond = useRespond(event?.id ?? '');
  const answers: Exclude<AttendeeResponse, 'needs_action'>[] = [
    'accepted',
    'tentative',
    'declined',
  ];

  if (editing && event) {
    return (
      <li className="rounded-xl border border-border bg-surface p-4 shadow-card">
        <EventForm event={event} defaultDate={date} onDone={() => setEditing(false)} />
      </li>
    );
  }

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

  const accent = KIND_ACCENT[item.kind];
  return (
    <li
      className={cn(
        'space-y-3 rounded-xl border border-l-4 border-border bg-surface p-4 shadow-card',
        accent.edge,
      )}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="break-words text-lg font-semibold leading-snug">
            {item.who ? `${item.who} · ` : ''}
            {item.title}
            {item.pending && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({t('day.pending')})
              </span>
            )}
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
            <p className="whitespace-pre-line break-words text-sm text-foreground/80">
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
      {event && !event.isOrganizer && event.scope === 'personal' && (
        <p className="text-sm text-muted-foreground">
          {t('guests.organizer', { name: `${event.owner.firstName} ${event.owner.lastName}` })}
        </p>
      )}
      {event && event.attendees.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('guests.label')}</p>
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {event.attendees.map((a) => (
              <li key={a.employee.id}>
                {a.employee.firstName} {a.employee.lastName} · {t(`guests.response.${a.response}`)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {event?.myResponse && (
        <div className="space-y-1" role="group" aria-label={t('rsvp.label')}>
          <p className="text-sm">
            {t('rsvp.current', { answer: t(`guests.response.${event.myResponse}`) })}
          </p>
          <div className="flex flex-wrap gap-2">
            {answers.map((answer) => (
              <Button
                key={answer}
                variant={event.myResponse === answer ? 'primary' : 'secondary'}
                aria-pressed={event.myResponse === answer}
                disabled={respond.isPending}
                onClick={() => respond.mutate(answer)}
              >
                {t(`rsvp.${answer}`)}
              </Button>
            ))}
          </div>
          {respond.isError && <Alert tone="danger">{errors.apiError(respond.error)}</Alert>}
        </div>
      )}
      {remove.isError && <Alert tone="danger">{errors.apiError(remove.error)}</Alert>}
      {event?.canEdit && !confirming && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t('event.edit')}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            {t('event.delete')}
          </Button>
        </div>
      )}
      {event && confirming && (
        <div className="space-y-2" role="group" aria-label={t('event.confirmDelete')}>
          <p className="text-sm">{t('event.confirmDelete')}</p>
          {event.recurrence && <SeriesScope value={mode} onChange={setMode} />}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(
                  {
                    id: event.id,
                    scope: mode === 'all' ? undefined : { mode, occurrence: event.occurrenceDate },
                  },
                  { onSuccess: () => setConfirming(false) },
                )
              }
            >
              {t('event.deleteConfirm')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('event.keep')}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
