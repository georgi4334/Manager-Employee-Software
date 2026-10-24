import { PROJECT_STATUSES, todayIn, type ProjectSummary } from '@intime/contracts';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { usePermission } from '@/features/auth/permissions';
import { useCurrentUser } from '@/features/auth/use-auth';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { cn } from '@/shared/lib/cn';
import { formatDay } from '@/shared/lib/format';
import { PAGE_SIZE, type ListParams } from './api';
import { ClientsTab } from './ClientsTab';
import { HealthBadge } from './HealthBadge';
import { useClients, useProjects } from './hooks';
import { ProjectForm } from './ProjectForm';
import { useProjectErrors } from './use-project-errors';

type Tab = 'projects' | 'clients';

export function ProjectsPage() {
  const { t } = useTranslation('projects');
  const { data: user } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const seesClients = usePermission('client.view');
  const tabs: Tab[] = seesClients ? ['projects', 'clients'] : ['projects'];
  const requested = params.get('tab');
  const tab: Tab = tabs.find((candidate) => candidate === requested) ?? 'projects';

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {tabs.length > 1 && (
        <div
          role="tablist"
          aria-label={t('tabs.label')}
          className="flex gap-1 overflow-x-auto rounded-lg bg-secondary p-1"
        >
          {tabs.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`projects-tab-${name}`}
              aria-selected={tab === name}
              aria-controls="projects-panel"
              onClick={() => setParams(name === 'projects' ? {} : { tab: name }, { replace: true })}
              className={cn(
                'min-h-11 flex-1 whitespace-nowrap rounded-md px-3 text-sm font-medium',
                tab === name ? 'bg-surface text-foreground shadow-card' : 'text-muted-foreground',
              )}
            >
              {t(`tabs.${name}`)}
            </button>
          ))}
        </div>
      )}
      <div role="tabpanel" id="projects-panel" aria-labelledby={`projects-tab-${tab}`}>
        {tab === 'projects' ? (
          <ProjectsList
            today={todayIn(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)}
          />
        ) : (
          <ClientsTab />
        )}
      </div>
    </div>
  );
}

function ProjectsList({ today }: { today: string }) {
  const { t } = useTranslation('projects');
  const errors = useProjectErrors();
  const navigate = useNavigate();
  const canCreate = usePermission('project.manage');
  const seesClients = usePermission('client.view');
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ListParams['status']>('all');
  const [clientId, setClientId] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const clients = useClients(seesClients);
  const query = useProjects({ q, status, clientId, page });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      {canCreate && !creating && <Button onClick={() => setCreating(true)}>{t('new')}</Button>}
      {creating && (
        <Card className="space-y-3">
          <h2 className="text-base font-semibold">{t('form.newTitle')}</h2>
          <ProjectForm
            today={today}
            onDone={(id) => {
              setCreating(false);
              if (id) void navigate(`/projects/${id}`);
            }}
          />
        </Card>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            className="pl-9"
            aria-label={t('search')}
            placeholder={t('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          className="sm:w-44"
          aria-label={t('filters.status')}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ListParams['status']);
            setPage(1);
          }}
        >
          <option value="all">{t('filters.allStatuses')}</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
        {seesClients && (
          <Select
            className="sm:w-48"
            aria-label={t('filters.client')}
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('filters.allClients')}</option>
            {(clients.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {query.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{errors.apiError(query.error)}</Alert>
          <Button onClick={() => void query.refetch()}>{t('retry')}</Button>
        </Card>
      )}
      {data && (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('total', { count: data.total })}
          </p>
          {data.items.length === 0 ? (
            <Card>
              <p className="text-center text-sm text-muted-foreground">{t('empty')}</p>
            </Card>
          ) : (
            <ul className="space-y-2" aria-label={t('title')}>
              {data.items.map((project) => (
                <ProjectRow key={project.id} project={project} />
              ))}
            </ul>
          )}
          {pages > 1 && (
            <nav className="flex items-center justify-between gap-2" aria-label={t('pagination')}>
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {t('previous')}
              </Button>
              <span className="text-sm text-muted-foreground">{t('page', { page, pages })}</span>
              <Button
                variant="secondary"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                {t('next')}
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function ProjectRow({ project }: { project: ProjectSummary }) {
  const { t, i18n } = useTranslation('projects');
  const language = i18n.resolvedLanguage ?? 'en';
  return (
    <li>
      <Link
        to={`/projects/${project.id}`}
        className="block space-y-1 rounded-xl border border-border bg-surface p-4 shadow-card hover:bg-surface-muted"
      >
        <span className="flex flex-wrap items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block font-medium">{project.name}</span>
            <span className="block text-sm text-muted-foreground">
              {project.code}
              {project.client && ` · ${project.client.name}`}
            </span>
          </span>
          <HealthBadge project={project} />
        </span>
        <span className="block text-sm text-muted-foreground">
          {project.lead
            ? t('lead', { name: `${project.lead.firstName} ${project.lead.lastName}` })
            : t('noLead')}
          {' · '}
          {project.endDate
            ? t('period', {
                from: formatDay(project.startDate, language),
                to: formatDay(project.endDate, language),
              })
            : t('since', { from: formatDay(project.startDate, language) })}
        </span>
      </Link>
    </li>
  );
}
