import type { ProjectDetail } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { formatDay } from '@/shared/lib/format';
import { positionPct } from './timeline';

/**
 * The project span as a bar with today and the milestones marked. The text below says the same in words, so the
 * picture is an addition, not the only way to learn it.
 */
export function Timeline({ project, today }: { project: ProjectDetail; today: string }) {
  const { t, i18n } = useTranslation('projects');
  const language = i18n.resolvedLanguage ?? 'en';
  if (!project.endDate) {
    return <p className="text-sm text-muted-foreground">{t('timeline.noEnd')}</p>;
  }
  const { startDate, endDate } = project;
  const elapsed = positionPct(today, startDate, endDate);
  const summary =
    today < startDate
      ? t('timeline.notStarted', { date: formatDay(startDate, language) })
      : today > endDate
        ? t('timeline.ended', { date: formatDay(endDate, language) })
        : t('timeline.elapsed', { percent: Math.round(elapsed) });

  return (
    <div className="space-y-2">
      <div
        role="img"
        aria-label={`${summary}. ${t('timeline.milestoneCount', { count: project.milestones.length })}`}
        className="relative h-6"
      >
        <div className="absolute inset-x-0 top-2.5 h-1.5 rounded-full bg-secondary" />
        <div
          className="absolute left-0 top-2.5 h-1.5 rounded-full bg-primary"
          style={{ width: `${elapsed}%` }}
        />
        {project.milestones.map((m) => (
          <span
            key={m.id}
            title={m.title}
            className={cn(
              'absolute top-1 size-4 -translate-x-1/2 rotate-45 border-2 border-surface',
              m.status === 'done' ? 'bg-success' : m.overdueDays > 0 ? 'bg-danger' : 'bg-info',
            )}
            style={{ left: `${positionPct(m.dueDate, startDate, endDate)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{formatDay(startDate, language)}</span>
        <span>{summary}</span>
        <span>{formatDay(endDate, language)}</span>
      </div>
    </div>
  );
}
