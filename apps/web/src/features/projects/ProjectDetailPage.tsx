import { todayIn, type ProjectDetail } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useCurrentUser } from '@/features/auth/use-auth';
import { isApiError } from '@/shared/api/api-error';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { formatDay, formatNumber } from '@/shared/lib/format';
import { HealthBadge } from './HealthBadge';
import { useProject } from './hooks';
import { MilestonesSection } from './MilestonesSection';
import { ProjectForm } from './ProjectForm';
import { TeamSection } from './TeamSection';
import { Timeline } from './Timeline';
import { useProjectErrors } from './use-project-errors';

export function ProjectDetailPage() {
  const { t } = useTranslation('projects');
  const errors = useProjectErrors();
  const { id = '' } = useParams();
  const { data: user } = useCurrentUser();
  const query = useProject(id);
  const today = todayIn(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link
        to="/projects"
        className="inline-flex min-h-11 items-center text-sm text-primary underline"
      >
        {t('back')}
      </Link>
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {query.isError &&
        (isApiError(query.error, 'NOT_FOUND') ? (
          <Card className="space-y-1 text-center">
            <CardTitle>{t('notFoundTitle')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('notFoundText')}</p>
          </Card>
        ) : (
          <Card className="space-y-3 text-center">
            <Alert tone="danger">{errors.apiError(query.error)}</Alert>
            <Button onClick={() => void query.refetch()}>{t('retry')}</Button>
          </Card>
        ))}
      {query.data && <Detail project={query.data} today={today} />}
    </div>
  );
}

function Detail({ project, today }: { project: ProjectDetail; today: string }) {
  const { t, i18n } = useTranslation('projects');
  const language = i18n.resolvedLanguage ?? 'en';
  const [editing, setEditing] = useState(false);

  return (
    <>
      <Card className="space-y-3">
        {editing ? (
          <>
            <CardTitle>{t('form.editTitle')}</CardTitle>
            <ProjectForm project={project} today={today} onDone={() => setEditing(false)} />
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold">{project.name}</h1>
                <p className="text-sm text-muted-foreground">
                  {project.code}
                  {project.client && ` · ${project.client.name}`}
                </p>
              </div>
              <HealthBadge project={project} />
            </div>
            {project.description && <p className="text-sm">{project.description}</p>}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <Item label={t('overview.status')} value={t(`status.${project.status}`)} />
              <Item label={t('overview.priority')} value={t(`priority.${project.priority}`)} />
              <Item
                label={t('overview.billable')}
                value={project.isBillable ? t('overview.yes') : t('overview.no')}
              />
              <Item
                label={t('overview.lead')}
                value={
                  project.lead ? `${project.lead.firstName} ${project.lead.lastName}` : t('noLead')
                }
              />
              <Item
                label={t('overview.budget')}
                value={
                  project.budgetHours === null
                    ? t('overview.none')
                    : t('overview.hours', { hours: formatNumber(project.budgetHours, language) })
                }
              />
              <Item
                label={t('overview.period')}
                value={
                  project.endDate
                    ? t('period', {
                        from: formatDay(project.startDate, language),
                        to: formatDay(project.endDate, language),
                      })
                    : t('since', { from: formatDay(project.startDate, language) })
                }
              />
            </dl>
            {project.canEdit && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t('overview.edit')}
              </Button>
            )}
          </>
        )}
      </Card>

      <Card className="space-y-3">
        <CardTitle>{t('timeline.title')}</CardTitle>
        <Timeline project={project} today={today} />
      </Card>

      <MilestonesSection project={project} today={today} />
      <TeamSection project={project} today={today} />
    </>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
