import type { ProjectDetail } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { formatDay } from '@/shared/lib/format';
import { MilestoneTrack, type MilestonePoint } from '@/shared/ui/milestone-track';
import { positionPct } from './timelinePosition';

/**
 * The project from start to end with its milestones and a Today pin (milestone track, ADR 0033). The sentence under
 * it says how much of the time has passed, so the picture is an addition, not the only way to learn it.
 */
export function Timeline({ project, today }: { project: ProjectDetail; today: string }) {
  const { t, i18n } = useTranslation('projects');
  const language = i18n.resolvedLanguage ?? 'en';
  const { startDate, endDate } = project;
  const points = timelinePoints(project, today, {
    start: t('timeline.start'),
    end: t('timeline.end'),
    late: (days) => t('timeline.late', { count: days }),
  });
  const summary = !endDate
    ? t('timeline.noEnd')
    : today < startDate
      ? t('timeline.notStarted', { date: formatDay(startDate, language) })
      : today > endDate
        ? t('timeline.ended', { date: formatDay(endDate, language) })
        : t('timeline.elapsed', { percent: Math.round(positionPct(today, startDate, endDate)) });

  return (
    <div className="space-y-3">
      <MilestoneTrack points={points} today={today} label={t('timeline.title')} />
      <p className="flex flex-wrap justify-between gap-x-3 text-sm text-muted-foreground">
        <span>{summary}</span>
        <span>{t('timeline.milestoneCount', { count: project.milestones.length })}</span>
      </p>
    </div>
  );
}

/** Start, the milestones by date and the end (when there is one); the first open future point is "next". */
export function timelinePoints(
  project: Pick<ProjectDetail, 'startDate' | 'endDate' | 'milestones'>,
  today: string,
  text: { start: string; end: string; late: (days: number) => string },
): MilestonePoint[] {
  const milestones = [...project.milestones].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const points: MilestonePoint[] = [
    {
      key: 'start',
      label: text.start,
      date: project.startDate,
      state: today >= project.startDate ? 'done' : 'upcoming',
    },
    ...milestones.map((m): MilestonePoint => ({
      key: m.id,
      label: m.title,
      date: m.dueDate,
      state: m.status === 'done' ? 'done' : m.overdueDays > 0 ? 'late' : 'upcoming',
      ...(m.overdueDays > 0 ? { note: text.late(m.overdueDays) } : {}),
    })),
  ];
  if (project.endDate) {
    points.push({
      key: 'end',
      label: text.end,
      date: project.endDate,
      state: today > project.endDate ? 'done' : 'upcoming',
    });
  }
  const next = points.findIndex((p) => p.state === 'upcoming');
  if (next >= 0) points[next] = { ...points[next]!, state: 'next' };
  return points;
}
