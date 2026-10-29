import { formatDuration, timeWeekChart, type TimeWeek } from '@intime/contracts';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { formatDay } from '@/shared/lib/format';
import { EntryForm } from './EntryForm';
import { EntryRow } from './EntryRow';

const BILLABLE = 'bg-chart-1';
const NOT_BILLABLE = 'bg-chart-8';
/** Grid lines every four hours. */
const STEP = 240;

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

interface WeekChartProps {
  week: TimeWeek;
  today: string;
  /** The day whose entries are listed under the chart. */
  selected: string;
  onSelect: (date: string) => void;
  /** Whether the week may take new entries (not locked, the person may log time). */
  canAdd: boolean;
  /** The entry form is open (for the selected day). */
  adding: boolean;
  onAdd: () => void;
  onAddDone: () => void;
}

/**
 * A week at a glance, drawn like the week view of the calendar: one column per day, the hours stacked
 * (billable at the bottom), a line at the 8-hour day, and the same per project below. Entries carry
 * hours, not clock times, so the height is the time spent. Every day is a button: it lists that day's
 * entries under the chart, where they can be changed or added to.
 */
export function WeekChart({
  week,
  today,
  selected,
  onSelect,
  canAdd,
  adding,
  onAdd,
  onAddDone,
}: WeekChartProps) {
  const { t, i18n } = useTranslation('time');
  const language = i18n.resolvedLanguage ?? 'en';
  const chart = useMemo(() => timeWeekChart(week), [week]);
  const lines: number[] = [];
  for (let m = STEP; m <= chart.scale; m += STEP) lines.push(m);
  const mostInProject = Math.max(0, ...chart.projects.map((p) => p.total));
  const day = chart.days.find((d) => d.date === selected);
  const dayEntries = week.entries.filter((e) => e.workDate === selected);
  const dayName = formatDay(selected, language, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
  const detail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (adding) detail.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [adding]);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{t('chart.title')}</h3>
        <span className="rounded-full border border-primary px-2.5 py-0.5 text-xs font-medium text-primary">
          {t('chart.share', { percent: chart.sharePercent })}
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <Stat label={t('chart.billable')} value={chart.billable} dot={BILLABLE} />
        <Stat label={t('chart.notBillable')} value={chart.nonBillable} dot={NOT_BILLABLE} />
        <Stat label={t('chart.total')} value={chart.total} />
      </dl>

      <div className="flex gap-2 pt-3">
        <div
          aria-hidden="true"
          className="relative h-44 w-12 shrink-0 text-right text-xs text-muted-foreground"
        >
          {lines.map((m) => (
            <span
              key={m}
              className="absolute right-0 -translate-y-1/2 tabular-nums"
              style={{ bottom: `${pct(m, chart.scale)}%` }}
            >
              {t('hours', { value: m / 60 })}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-44">
            {lines.map((m) => (
              <div
                key={m}
                className={cn(
                  'absolute inset-x-0 border-t',
                  m === 480 ? 'border-dashed border-primary' : 'border-border',
                )}
                style={{ bottom: `${pct(m, chart.scale)}%` }}
              />
            ))}
            {chart.total === 0 && (
              <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
                {t('chart.empty')}
              </p>
            )}
          </div>
          <div
            role="group"
            aria-label={t('week.days')}
            className="relative grid grid-cols-7 gap-1.5 sm:gap-3"
          >
            {chart.days.map((d) => {
              const on = d.date === selected;
              return (
                <button
                  key={d.date}
                  type="button"
                  aria-pressed={on}
                  aria-label={t('chart.dayLabel', {
                    date: formatDay(d.date, language, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'short',
                    }),
                    total: formatDuration(d.total),
                    billable: formatDuration(d.billable),
                  })}
                  onClick={() => onSelect(d.date)}
                  className={cn(
                    'flex min-w-0 cursor-pointer flex-col rounded-md text-center text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                    on ? 'bg-accent ring-2 ring-primary' : 'hover:bg-surface-muted',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-44 w-full flex-col justify-end rounded-md',
                      d.target === 0 && !on && 'bg-surface-muted',
                    )}
                  >
                    <span
                      className={cn('block w-full rounded-t-md', NOT_BILLABLE)}
                      style={{ height: `${pct(d.nonBillable, chart.scale)}%` }}
                    />
                    <span
                      className={cn(
                        'block w-full',
                        BILLABLE,
                        d.nonBillable === 0 && 'rounded-t-md',
                      )}
                      style={{ height: `${pct(d.billable, chart.scale)}%` }}
                    />
                  </span>
                  <span
                    aria-hidden="true"
                    className="mt-2 flex min-w-0 flex-col items-center gap-0.5 pb-1"
                  >
                    <span
                      className={cn(
                        'flex flex-col items-center rounded-md px-0.5 py-0.5 font-medium sm:flex-row sm:justify-center sm:gap-1',
                        d.date === today
                          ? 'bg-accent text-accent-foreground'
                          : on
                            ? 'text-accent-foreground'
                            : 'text-muted-foreground',
                      )}
                    >
                      <span className="sm:hidden">
                        {formatDay(d.date, language, { weekday: 'narrow' })}
                      </span>
                      <span className="hidden sm:inline">
                        {formatDay(d.date, language, { weekday: 'short' })}
                      </span>
                      <span>{formatDay(d.date, language, { day: 'numeric' })}</span>
                    </span>
                    <span className="text-[11px] tabular-nums sm:text-xs">
                      {d.total > 0 ? formatDuration(d.total) : '–'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('chart.pick')}</p>

      <section
        ref={detail}
        aria-label={t('chart.dayEntries', { date: dayName })}
        className="space-y-3 border-t border-border pt-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold">{dayName}</h4>
          <p className="text-sm tabular-nums text-muted-foreground">
            {t('hours', { value: formatDuration(day?.total ?? 0) })}
            {(day?.total ?? 0) > 0 &&
              ` · ${t('chart.billableShort', { value: formatDuration(day?.billable ?? 0) })}`}
          </p>
        </div>
        {dayEntries.length > 0 ? (
          <ul className="space-y-2" aria-label={t('chart.dayEntries', { date: dayName })}>
            {dayEntries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </ul>
        ) : (
          !adding && <p className="text-sm text-muted-foreground">{t('chart.dayEmpty')}</p>
        )}
        {adding && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <h5 className="text-sm font-semibold">{t('entry.addTitle')}</h5>
            <EntryForm key={selected} defaultDate={selected} onDone={onAddDone} />
          </div>
        )}
        {canAdd && !adding && (
          <Button variant="secondary" onClick={onAdd}>
            <Plus className="mr-1 size-4" aria-hidden="true" />
            {t('chart.addForDay')}
          </Button>
        )}
      </section>

      {chart.projects.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">{t('chart.byProject')}</h4>
          <ul className="space-y-3" aria-label={t('chart.byProject')}>
            {chart.projects.map((project) => (
              <li key={project.projectId} className="space-y-1">
                <p className="break-words text-sm font-medium">
                  {project.code} · {project.name}
                </p>
                <div
                  aria-hidden="true"
                  className="flex h-2 overflow-hidden rounded-full bg-secondary"
                  style={{ width: `${Math.max(4, pct(project.total, mostInProject))}%` }}
                >
                  <span
                    className={BILLABLE}
                    style={{ width: `${pct(project.billable, project.total)}%` }}
                  />
                  <span
                    className={NOT_BILLABLE}
                    style={{ width: `${pct(project.nonBillable, project.total)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('chart.projectLine', {
                    billable: formatDuration(project.billable),
                    notBillable: formatDuration(project.nonBillable),
                  })}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('chart.note')}</p>
    </Card>
  );
}

function Stat({ label, value, dot }: { label: string; value: number; dot?: string }) {
  const { t } = useTranslation('time');
  return (
    <div className="rounded-lg border border-border p-2.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {dot && <span aria-hidden="true" className={cn('size-2.5 rounded-full', dot)} />}
        {label}
      </dt>
      <dd className="text-lg font-semibold tabular-nums">
        {t('hours', { value: formatDuration(value) })}
      </dd>
    </div>
  );
}
