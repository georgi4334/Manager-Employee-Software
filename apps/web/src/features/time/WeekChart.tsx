import { formatDuration, timeWeekChart, type TimeWeek } from '@intime/contracts';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Card } from '@/shared/ui/card';
import { formatDay } from '@/shared/lib/format';

const BILLABLE = 'bg-chart-1';
const NOT_BILLABLE = 'bg-chart-8';
/** Grid lines every four hours. */
const STEP = 240;

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

/**
 * A week at a glance, drawn like the week view of the calendar: one column per day, the hours stacked
 * (billable at the bottom), a line at the 8-hour day, and the same per project below. Entries carry
 * hours, not clock times, so the height is the time spent. Decoration only: the values are in text
 * and the day list below is the accessible route.
 */
export function WeekChart({ week, today }: { week: TimeWeek; today: string }) {
  const { t, i18n } = useTranslation('time');
  const language = i18n.resolvedLanguage ?? 'en';
  const chart = useMemo(() => timeWeekChart(week), [week]);
  const lines: number[] = [];
  for (let m = STEP; m <= chart.scale; m += STEP) lines.push(m);
  const mostInProject = Math.max(0, ...chart.projects.map((p) => p.total));

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

      <div aria-hidden="true" className="flex gap-2 pt-3">
        <div className="relative h-44 w-12 shrink-0 text-right text-xs text-muted-foreground">
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
        <div className="min-w-0 flex-1">
          <div className="relative h-44">
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
            <div className="absolute inset-0 grid grid-cols-7 gap-1.5 sm:gap-3">
              {chart.days.map((day) => (
                <div
                  key={day.date}
                  className={cn(
                    'flex h-full flex-col justify-end rounded-md',
                    day.target === 0 && 'bg-surface-muted',
                  )}
                >
                  <div
                    className={cn('w-full rounded-t-md', NOT_BILLABLE)}
                    style={{ height: `${pct(day.nonBillable, chart.scale)}%` }}
                  />
                  <div
                    className={cn('w-full', BILLABLE, day.nonBillable === 0 && 'rounded-t-md')}
                    style={{ height: `${pct(day.billable, chart.scale)}%` }}
                  />
                </div>
              ))}
            </div>
            {chart.total === 0 && (
              <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
                {t('chart.empty')}
              </p>
            )}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1.5 text-center text-xs sm:gap-3">
            {chart.days.map((day) => (
              <div key={day.date} className="min-w-0 space-y-0.5">
                <p
                  className={cn(
                    'flex flex-col items-center rounded-md px-0.5 py-0.5 font-medium sm:flex-row sm:justify-center sm:gap-1',
                    day.date === today
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  <span className="sm:hidden">
                    {formatDay(day.date, language, { weekday: 'narrow' })}
                  </span>
                  <span className="hidden sm:inline">
                    {formatDay(day.date, language, { weekday: 'short' })}
                  </span>
                  <span>{formatDay(day.date, language, { day: 'numeric' })}</span>
                </p>
                <p className="text-[11px] tabular-nums sm:text-xs">
                  {day.total > 0 ? formatDuration(day.total) : '–'}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

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
