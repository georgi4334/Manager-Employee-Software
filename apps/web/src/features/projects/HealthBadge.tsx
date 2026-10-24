import type { ProjectHealth, ProjectSummary } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

const STYLE: Record<ProjectHealth, string> = {
  on_track: 'border border-success text-success',
  at_risk: 'border border-warning text-warning',
  off_track: 'border border-danger text-danger',
};

/** Health is always a word, never only a color. Inactive projects show their status instead. */
export function HealthBadge({ project }: { project: Pick<ProjectSummary, 'health' | 'status'> }) {
  const { t } = useTranslation('projects');
  if (!project.health) {
    return (
      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
        {t(`status.${project.status}`)}
      </span>
    );
  }
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STYLE[project.health])}>
      {t(`health.${project.health}`)}
    </span>
  );
}
