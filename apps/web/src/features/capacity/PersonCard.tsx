import { formatDuration, type CapacityPerson } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { formatDay } from '@/shared/lib/format';

const LEVEL_TONE: Record<CapacityPerson['level'], string> = {
  none: 'border-border text-muted-foreground',
  free: 'border-success text-success',
  busy: 'border-primary text-primary',
  full: 'border-warning text-warning',
  over: 'border-danger text-danger',
};

export function PersonCard({ person }: { person: CapacityPerson }) {
  const { t, i18n } = useTranslation('capacity');
  const language = i18n.resolvedLanguage ?? 'en';
  const hours = (minutes: number) => t('hours', { value: formatDuration(minutes) });
  const name = `${person.employee.firstName} ${person.employee.lastName}`;

  return (
    <li className="space-y-2 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words font-medium">{name}</p>
        <span className={cn('rounded-full border px-2 py-0.5 text-xs', LEVEL_TONE[person.level])}>
          {t(`level.${person.level}`)}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {t('numbers', {
          available: hours(person.availableMinutes),
          planned: hours(person.plannedMinutes),
          logged: hours(person.loggedMinutes),
          free: hours(person.freeMinutes),
        })}
      </p>
      {person.overtimeMinutes > 0 && (
        <p className="text-sm font-medium text-warning">
          {t('overtime', { overtime: hours(person.overtimeMinutes) })}
        </p>
      )}
      <details className="text-sm">
        <summary
          className="flex min-h-11 cursor-pointer items-center text-primary underline"
          aria-label={t('details.show', { name })}
        >
          {t('details.title')}
        </summary>
        <ul className="mt-2 space-y-1" aria-label={t('details.days', { name })}>
          {person.days.map((d) => (
            <li key={d.date}>
              <span className="font-medium">
                {formatDay(d.date, language, { weekday: 'short', day: 'numeric', month: 'short' })}
              </span>
              {': '}
              {t(`day.${d.status}`)}
              {d.availableMinutes > 0 &&
                ` · ${t('dayNumbers', {
                  planned: formatDuration(d.plannedMinutes),
                  available: formatDuration(d.availableMinutes),
                })}`}
              {d.loggedMinutes > 0 &&
                ` · ${t('dayLogged', { logged: formatDuration(d.loggedMinutes) })}`}
            </li>
          ))}
        </ul>
        {person.projects.length > 0 && (
          <ul className="mt-3 space-y-1" aria-label={t('details.projects', { name })}>
            {person.projects.map((p) => (
              <li key={p.id ?? 'other'}>
                <span className="font-medium">
                  {p.id ? `${p.code} · ${p.name}` : t('details.otherProjects')}
                </span>
                {': '}
                {t('projectNumbers', {
                  planned: formatDuration(p.plannedMinutes),
                  logged: formatDuration(p.loggedMinutes),
                })}
              </li>
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}
