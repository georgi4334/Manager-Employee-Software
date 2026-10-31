import { formatDuration, type CapacityPerson } from '@intime/contracts';
import { CalendarOff, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { formatDay } from '@/shared/lib/format';
import { TargetBar, targetScale, type BarTone } from '@/shared/ui/progress';
import { Tile, initials } from '@/shared/ui/tiles';

type Level = CapacityPerson['level'];
type DayStatus = CapacityPerson['days'][number]['status'];

/** The pill and the bar of a level: the same tokens the rest of the app uses for these meanings. */
const LEVEL_TONE: Record<Level, { pill: string; bar: BarTone }> = {
  none: { pill: 'border-border text-muted-foreground', bar: 'muted' },
  free: { pill: 'border-success text-success', bar: 'success' },
  busy: { pill: 'border-primary text-primary', bar: 'primary' },
  full: { pill: 'border-warning text-warning', bar: 'warning' },
  over: { pill: 'border-danger text-danger', bar: 'danger' },
};

const DAY_TONE: Record<DayStatus, { text: string; bar: BarTone }> = {
  off: { text: 'text-muted-foreground', bar: 'muted' },
  leave: { text: 'text-info', bar: 'info' },
  partly_leave: { text: 'text-info', bar: 'info' },
  free: { text: 'text-success', bar: 'success' },
  busy: { text: 'text-primary', bar: 'primary' },
  full: { text: 'text-warning', bar: 'warning' },
  over: { text: 'text-danger', bar: 'danger' },
};

export function PersonCard({ person }: { person: CapacityPerson }) {
  const { t, i18n } = useTranslation('capacity');
  const language = i18n.resolvedLanguage ?? 'en';
  const hours = (minutes: number) => t('hours', { value: formatDuration(minutes) });
  const name = `${person.employee.firstName} ${person.employee.lastName}`;
  const tone = LEVEL_TONE[person.level];
  const planned = person.availableMinutes > 0 ? person.plannedMinutes / person.availableMinutes : 0;
  const biggest = Math.max(
    0,
    ...person.projects.map((p) => Math.max(p.plannedMinutes, p.loggedMinutes)),
  );
  const plannedTotal = person.projects.reduce((sum, p) => sum + p.plannedMinutes, 0);
  const stats = [
    { key: 'available', value: person.availableMinutes },
    { key: 'planned', value: person.plannedMinutes },
    { key: 'logged', value: person.loggedMinutes },
    { key: 'free', value: person.freeMinutes },
  ] as const;

  return (
    <li className="space-y-4 rounded-xl glass p-4">
      <div className="flex items-center gap-3">
        <Tile>{initials(person.employee.firstName, person.employee.lastName)}</Tile>
        <div className="min-w-0 flex-1">
          <p className="break-words text-base font-semibold leading-snug">{name}</p>
          {person.availableMinutes > 0 && (
            <span className="text-sm text-muted-foreground">
              {t('percentPlanned', { percent: Math.round(planned * 100) })}
            </span>
          )}
        </div>
        <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium', tone.pill)}>
          {t(`level.${person.level}`)}
        </span>
      </div>

      {person.availableMinutes > 0 && (
        <TargetBar value={person.plannedMinutes} target={person.availableMinutes} tone={tone.bar} />
      )}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(({ key, value }) => (
          <div key={key} className="rounded-lg border border-border px-3 py-2">
            <dt className="text-xs text-muted-foreground">{t(`stats.${key}`)}</dt>
            <dd className="text-base font-semibold tabular-nums">{hours(value)}</dd>
          </div>
        ))}
      </dl>

      {person.overtimeMinutes > 0 && (
        <p className="text-sm font-medium text-warning">
          {t('overtime', { overtime: hours(person.overtimeMinutes) })}
        </p>
      )}

      <details className="group rounded-lg border border-border">
        <summary
          className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 text-sm font-medium text-primary hover:bg-surface-muted [&::-webkit-details-marker]:hidden"
          aria-label={t('details.show', { name })}
        >
          <span>{t('details.title')}</span>
          <ChevronDown
            className="size-5 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>

        <div className="space-y-5 border-t border-border p-3">
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <h3 className="text-sm font-semibold">{t('details.daysHeading')}</h3>
              <p aria-hidden="true" className="flex gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-primary" />
                  {t('legend.planned')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-info" />
                  {t('legend.logged')}
                </span>
              </p>
            </div>
            <ul className="divide-y divide-border" aria-label={t('details.days', { name })}>
              {person.days.map((d) => {
                const day = DAY_TONE[d.status];
                const bars = d.availableMinutes > 0;
                return (
                  <li
                    key={d.date}
                    className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 py-2 sm:grid-cols-[7rem_1fr]"
                  >
                    <span className="text-sm font-medium">
                      {formatDay(d.date, language, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                    <span className="min-w-0 space-y-1.5">
                      {bars && (
                        <span className="block">
                          <TargetBar
                            value={d.plannedMinutes}
                            target={d.availableMinutes}
                            tone={day.bar}
                            scale={targetScale(
                              Math.max(d.plannedMinutes, d.loggedMinutes),
                              d.availableMinutes,
                            )}
                          />
                          {d.loggedMinutes > 0 && (
                            <TargetBar
                              thin
                              value={d.loggedMinutes}
                              target={d.availableMinutes}
                              tone="info"
                              scale={targetScale(
                                Math.max(d.plannedMinutes, d.loggedMinutes),
                                d.availableMinutes,
                              )}
                            />
                          )}
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 text-sm">
                        {(d.status === 'leave' || d.status === 'off') && (
                          <CalendarOff
                            className={cn('size-4 shrink-0', day.text)}
                            aria-hidden="true"
                          />
                        )}
                        <span className="min-w-0">
                          <span className={cn('font-medium', day.text)}>
                            {t(`day.${d.status}`)}
                          </span>
                          {d.availableMinutes > 0 &&
                            ` · ${t('dayNumbers', {
                              planned: formatDuration(d.plannedMinutes),
                              available: formatDuration(d.availableMinutes),
                            })}`}
                          {d.loggedMinutes > 0 &&
                            ` · ${t('dayLogged', { logged: formatDuration(d.loggedMinutes) })}`}
                        </span>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {person.projects.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t('details.projectsHeading')}</h3>
              <ul className="space-y-3" aria-label={t('details.projects', { name })}>
                {person.projects.map((p) => (
                  <li key={p.id ?? 'other'} className="space-y-1.5">
                    <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="min-w-0 break-words text-sm font-medium">
                        {p.id ? `${p.code} · ${p.name}` : t('details.otherProjects')}
                      </span>
                      {plannedTotal > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {t('projectShare', {
                            percent: Math.round((p.plannedMinutes / plannedTotal) * 100),
                          })}
                        </span>
                      )}
                    </p>
                    <span className="block space-y-1">
                      <TargetBar value={p.plannedMinutes} target={0} scale={biggest} />
                      {p.loggedMinutes > 0 && (
                        <TargetBar
                          thin
                          value={p.loggedMinutes}
                          target={0}
                          scale={biggest}
                          tone="info"
                        />
                      )}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {t('projectNumbers', {
                        planned: formatDuration(p.plannedMinutes),
                        logged: formatDuration(p.loggedMinutes),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </details>
    </li>
  );
}
