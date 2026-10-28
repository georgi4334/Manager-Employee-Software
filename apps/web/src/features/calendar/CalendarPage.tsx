import { todayIn } from '@intime/contracts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePermission } from '@/features/auth/permissions';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useHolidays } from '@/features/leave/hooks';
import { useHolidayName, useTypeName } from '@/features/leave/names';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';
import { formatDay } from '@/shared/lib/format';
import { CALENDAR_VIEWS, eachDay, rangeFor, shift, yearsIn, type CalendarView } from './dates';
import { DayList } from './DayList';
import { EventForm } from './EventForm';
import { useEvents, useLeaveLayer } from './hooks';
import { EventDialog } from './EventDialog';
import { KIND_DOT } from './kinds';
import { ITEM_KINDS, itemFromEvent, type CalendarItem, type ItemKind } from './items';
import { MonthGrid } from './MonthGrid';
import { useCalendarErrors } from './use-calendar-errors';
import { TabList } from '@/shared/ui/tabs';
import { useMediaQuery } from '@/shared/lib/use-media-query';
import { TimeGrid } from './TimeGrid';
import { useNowMinutes } from './use-now';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isView = (value: string | null): value is CalendarView =>
  CALENDAR_VIEWS.includes(value as CalendarView);

/** Narrow screens start with the agenda, wider ones with the month. */
const defaultView = (): CalendarView =>
  typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches
    ? 'agenda'
    : 'month';

export function CalendarPage() {
  const { t, i18n } = useTranslation('calendar');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useCalendarErrors();
  const typeName = useTypeName();
  const holidayName = useHolidayName();
  const { t: tLeave } = useTranslation('leave');
  const { data: user } = useCurrentUser();
  const canSeeLeave = usePermission('leave.view');
  const [params, setParams] = useSearchParams();
  const [layers, setLayers] = useState<ReadonlySet<ItemKind>>(new Set(ITEM_KINDS));
  const [creating, setCreating] = useState(false);
  const [opened, setOpened] = useState<{ key: string; date: string } | null>(null);

  // Dates follow the user's own time zone setting when there is one, else the browser's.
  const zone = user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayIn(zone);
  const now = useNowMinutes(zone);
  const wide = useMediaQuery('(min-width: 768px)');
  const requestedView = params.get('view');
  const view: CalendarView = isView(requestedView) ? requestedView : defaultView();
  const requestedDate = params.get('date');
  const anchor = requestedDate && DATE.test(requestedDate) ? requestedDate : today;
  const go = (next: { view?: CalendarView; date?: string }) =>
    setParams({ view: next.view ?? view, date: next.date ?? anchor }, { replace: true });

  const { from, to } = rangeFor(view, anchor);
  const events = useEvents(from, to);
  const leave = useLeaveLayer(from, to, canSeeLeave && layers.has('leave'));
  const [firstYear = 0, lastYear = firstYear] = yearsIn(from, to);
  const holidaysA = useHolidays(firstYear, '');
  const holidaysB = useHolidays(lastYear, '');

  const items = useMemo(() => {
    const list: CalendarItem[] = [];
    for (const event of events.data?.items ?? []) list.push(itemFromEvent(event));
    if (canSeeLeave) {
      for (const request of leave.data ?? []) {
        list.push({
          key: `leave:${request.id}`,
          kind: 'leave',
          who: `${request.employee.firstName} ${request.employee.lastName}`,
          title: request.leaveType ? typeName(request.leaveType) : tLeave('absent'),
          startDate: request.startDate,
          endDate: request.endDate,
          allDay: true,
          startTime: null,
          endTime: null,
          pending: request.status === 'pending',
        });
      }
    }
    const holidays = [
      ...(holidaysA.data ?? []),
      ...(firstYear === lastYear ? [] : (holidaysB.data ?? [])),
    ];
    for (const holiday of holidays) {
      if (holiday.date < from || holiday.date > to) continue;
      list.push({
        key: `holiday:${holiday.date}:${holiday.key ?? holiday.name ?? ''}`,
        kind: 'holiday',
        title: holidayName(holiday),
        startDate: holiday.date,
        endDate: holiday.date,
        allDay: true,
        startTime: null,
        endTime: null,
      });
    }
    return list.filter((item) => layers.has(item.kind));
    // The name helpers change with the language only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    events.data,
    leave.data,
    holidaysA.data,
    holidaysB.data,
    layers,
    canSeeLeave,
    from,
    to,
    language,
  ]);

  const days = eachDay(from, to);
  const title =
    view === 'month'
      ? formatDay(anchor, language, { month: 'long', year: 'numeric' })
      : view === 'day'
        ? formatDay(anchor, language, { dateStyle: 'full' })
        : `${formatDay(from, language)} – ${formatDay(to, language)}`;
  const toggle = (kind: ItemKind) =>
    setLayers((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  const failed = events.error ?? leave.error;
  const selected = anchor;
  const openItem = opened ? (items.find((i) => i.key === opened.key) ?? null) : null;
  const open = (item: CalendarItem, date: string) => setOpened({ key: item.key, date });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Button onClick={() => setCreating(true)} disabled={creating}>
          {t('event.new')}
        </Button>
      </div>

      {creating && (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-card">
          <h2 className="text-base font-semibold">{t('form.newTitle')}</h2>
          <EventForm defaultDate={selected} onDone={() => setCreating(false)} />
        </section>
      )}

      <TabList
        label={t('views.label')}
        tabs={CALENDAR_VIEWS.map((name) => ({ name, label: t(`views.${name}`) }))}
        value={view}
        onChange={(name) => go({ view: name as (typeof CALENDAR_VIEWS)[number] })}
      />

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('nav.previous')}
          onClick={() => go({ date: shift(view, anchor, -1) })}
        >
          ‹
        </Button>
        <div className="flex flex-col items-center">
          <p className="text-center font-medium" aria-live="polite">
            {title}
          </p>
          <Button variant="ghost" onClick={() => go({ date: today })}>
            {t('nav.today')}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('nav.next')}
          onClick={() => go({ date: shift(view, anchor, 1) })}
        >
          ›
        </Button>
      </div>

      <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
        <legend className="sr-only">{t('layers.label')}</legend>
        {ITEM_KINDS.filter((kind) => kind !== 'leave' || canSeeLeave).map((kind) => (
          <label key={kind} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={layers.has(kind)}
              onChange={() => toggle(kind)}
            />
            <span
              className={cn('inline-block size-3 rounded-full', KIND_DOT[kind])}
              aria-hidden="true"
            />
            {t(`layers.${kind}`)}
          </label>
        ))}
      </fieldset>

      {failed && <Alert tone="danger">{errors.apiError(failed)}</Alert>}
      {events.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}

      {view === 'month' ? (
        <div className="space-y-4">
          <MonthGrid
            anchor={anchor}
            selected={selected}
            today={today}
            items={items}
            onSelect={(date) => go({ date })}
            onOpen={open}
            wide={wide}
          />
          <DayList days={[selected]} items={items} today={today} onOpen={open} />
        </div>
      ) : wide && (view === 'week' || view === 'day') ? (
        <div className="space-y-4">
          <TimeGrid
            days={days}
            items={items}
            today={today}
            now={now}
            selected={selected}
            onSelect={(date) => go({ date })}
            onOpen={open}
          />
          <DayList days={[selected]} items={items} today={today} onOpen={open} />
        </div>
      ) : (
        <DayList
          days={days}
          items={items}
          today={today}
          skipEmpty={view === 'agenda'}
          onOpen={open}
        />
      )}

      <EventDialog
        item={openItem}
        date={opened?.date ?? selected}
        onClose={() => setOpened(null)}
      />
    </div>
  );
}
