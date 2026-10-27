import type { AttendeeResponse, SeriesMode } from '@intime/contracts';
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

  return (
    <li className="space-y-2 rounded-xl border border-border bg-surface p-3 shadow-card">
      <div className="flex items-start gap-3">
        <span
          className={cn('mt-1.5 inline-block size-3 shrink-0 rounded-full', KIND_DOT[item.kind])}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {item.who ? `${item.who} · ` : ''}
            {item.title}
            {item.pending && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({t('day.pending')})
              </span>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(`layers.${item.kind}`)} · {when}
            {span && ` · ${span}`}
          </p>
          {event?.team && <p className="text-sm text-muted-foreground">{event.team.name}</p>}
          {event?.recurrence && (
            <p className="text-sm text-muted-foreground">
              {t(`repeat.summary.${event.recurrence.freq}`, { count: event.recurrence.interval })}
            </p>
          )}
          {event?.location && <p className="text-sm">{event.location}</p>}
          {event?.description && (
            <p className="text-sm text-muted-foreground">{event.description}</p>
          )}
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
