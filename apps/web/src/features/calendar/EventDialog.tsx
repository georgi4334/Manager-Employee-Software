import type { AttendeeResponse, SeriesMode } from '@intime/contracts';
import { Bell, CalendarDays, Clock, Eye, MapPin, Repeat, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/modal';
import { cn } from '@/shared/lib/cn';
import { formatDay } from '@/shared/lib/format';
import { EventForm } from './EventForm';
import { useDeleteEvent, useRespond } from './hooks';
import { KIND_ACCENT, KIND_DOT } from './kinds';
import type { CalendarItem } from './items';
import { SeriesScope } from './SeriesScope';
import { useCalendarErrors } from './use-calendar-errors';

interface EventDialogProps {
  /** The item that was opened, or null while the dialog is closed. */
  item: CalendarItem | null;
  /** The day it was opened on (a multi-day item shows that day's time). */
  date: string;
  onClose: () => void;
}

/**
 * What was clicked, in a dialog. Everybody who can see an item can read its details here; the
 * buttons to change it appear only when the server says the caller may (`canEdit`).
 */
export function EventDialog({ item, date, onClose }: EventDialogProps) {
  const { t } = useTranslation('calendar');
  // Keep the last item while the dialog animates out.
  const [shown, setShown] = useState<{ item: CalendarItem; date: string } | null>(null);
  if (item && (shown?.item !== item || shown.date !== date)) setShown({ item, date });
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // A different item starts in the reading view.
  const [seen, setSeen] = useState<string | null>(null);
  if ((item?.key ?? null) !== seen) {
    setSeen(item?.key ?? null);
    setEditing(false);
    setConfirming(false);
  }

  const close = () => {
    setEditing(false);
    setConfirming(false);
    onClose();
  };
  if (!shown) return null;
  const { item: current, date: day } = shown;
  const accent = KIND_ACCENT[current.kind];
  const title = `${current.who ? `${current.who} · ` : ''}${current.title}`;

  return (
    <Modal
      open={Boolean(item)}
      onClose={close}
      title={title}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <span
            className={cn('inline-block size-2 rounded-full', KIND_DOT[current.kind])}
            aria-hidden="true"
          />
          <span className={cn('font-medium', accent.text)}>{t(`layers.${current.kind}`)}</span>
        </span>
      }
    >
      {editing && current.event ? (
        <EventForm event={current.event} defaultDate={day} onDone={() => setEditing(false)} />
      ) : (
        <Details
          item={current}
          date={day}
          confirming={confirming}
          onEdit={() => setEditing(true)}
          onConfirm={setConfirming}
          onClose={close}
        />
      )}
    </Modal>
  );
}

function Details({
  item,
  date,
  confirming,
  onEdit,
  onConfirm,
  onClose,
}: {
  item: CalendarItem;
  date: string;
  confirming: boolean;
  onEdit: () => void;
  onConfirm: (value: boolean) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('calendar');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useCalendarErrors();
  const remove = useDeleteEvent();
  const [mode, setMode] = useState<SeriesMode>('all');
  const event = item.event;
  const respond = useRespond(event?.id ?? '');
  const answers: Exclude<AttendeeResponse, 'needs_action'>[] = [
    'accepted',
    'tentative',
    'declined',
  ];

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
    <>
      <ul aria-label={t('day.details')} className="space-y-3 text-sm">
        <Row icon={CalendarDays}>
          {formatDay(date, language, { dateStyle: 'full' })}
          {item.pending && <span className="ml-2 text-muted-foreground">({t('day.pending')})</span>}
        </Row>
        <Row icon={Clock}>
          {when}
          {span && <span className="block text-muted-foreground">{span}</span>}
        </Row>
        {event?.team && <Row icon={Users}>{event.team.name}</Row>}
        {event?.recurrence && (
          <Row icon={Repeat}>
            {t(`repeat.summary.${event.recurrence.freq}`, { count: event.recurrence.interval })}
          </Row>
        )}
        {event?.reminderMinutes && (
          <Row icon={Bell}>{t(`reminder.shown.${event.reminderMinutes === 1440 ? 1440 : 60}`)}</Row>
        )}
        {event?.location && <Row icon={MapPin}>{event.location}</Row>}
      </ul>

      {event?.description && (
        <p className="whitespace-pre-line break-words text-sm text-foreground/80">
          {event.description}
        </p>
      )}

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
        <div className="space-y-2" role="group" aria-label={t('rsvp.label')}>
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
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={onEdit}>
            {t('event.edit')}
          </Button>
          <Button variant="ghost" onClick={() => onConfirm(true)}>
            {t('event.delete')}
          </Button>
        </div>
      )}
      {event && !event.canEdit && (
        <p className="flex items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
          <Eye className="size-4 shrink-0" aria-hidden="true" />
          {t('event.viewOnly')}
        </p>
      )}
      {!event && (
        <p className="flex items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
          <Eye className="size-4 shrink-0" aria-hidden="true" />
          {t(item.kind === 'holiday' ? 'event.holidayInfo' : 'event.leaveInfo')}
        </p>
      )}
      {event && confirming && (
        <div
          className="space-y-2 border-t border-border pt-4"
          role="group"
          aria-label={t('event.confirmDelete')}
        >
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
                  {
                    onSuccess: () => {
                      onConfirm(false);
                      onClose();
                    },
                  },
                )
              }
            >
              {t('event.deleteConfirm')}
            </Button>
            <Button variant="ghost" onClick={() => onConfirm(false)}>
              {t('event.keep')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 break-words pt-0.5">{children}</span>
    </li>
  );
}
