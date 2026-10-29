import { PROJECT_STATUSES, todayIn, type ProjectSummary } from '@intime/contracts';
import { CalendarDays, Building2, FolderKanban, Search } from 'lucide-react';
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
import { formatDay } from '@/shared/lib/format';
import { PAGE_SIZE, type ListParams } from './api';
import { ClientsTab } from './ClientsTab';
import { HealthBadge } from './HealthBadge';
import { useClients, useProjects } from './hooks';
import { ProjectForm } from './ProjectForm';
import { useProjectErrors } from './use-project-errors';
import { SkeletonGroup, Skeleton } from '@/shared/ui/skeleton';
import { TabList, TabPanel } from '@/shared/ui/tabs';
import { Chip, Tile, initials } from '@/shared/ui/tiles';

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
        <TabList
          label={t('tabs.label')}
          idPrefix="projects"
          tabs={tabs.map((name) => ({ name, label: t(`tabs.${name}`) }))}
          value={tab ?? ''}
          onChange={(name) =>
            setParams(name === 'projects' ? {} : { tab: name }, { replace: true })
          }
        />
      )}
      <TabPanel value={tab ?? ''} idPrefix="projects">
        {tab === 'projects' ? (
          <ProjectsList
            today={todayIn(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)}
          />
        ) : (
          <ClientsTab />
        )}
      </TabPanel>
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
        <SkeletonGroup label={t('loading')} className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="space-y-4 rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between">
                <Skeleton className="size-11 rounded-xl" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-5 w-3/5" />
                <Skeleton className="h-3.5 w-2/5" />
              </div>
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </SkeletonGroup>
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
            <ul className="grid gap-3 sm:grid-cols-2" aria-label={t('title')}>
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
  const period = project.endDate
    ? t('period', {
        from: formatDay(project.startDate, language),
        to: formatDay(project.endDate, language),
      })
    : t('since', { from: formatDay(project.startDate, language) });
  return (
    <li>
      <Link
        to={`/projects/${project.id}`}
        className="flex h-full flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-card transition-transform duration-[var(--dur-fast)] ease-[var(--ease-ios)] hover:bg-surface-muted motion-safe:hover:-translate-y-0.5"
      >
        <span className="flex items-start justify-between gap-2">
          <Tile>
            <FolderKanban className="size-5" />
          </Tile>
          <HealthBadge project={project} />
        </span>
        <span className="block min-w-0 space-y-1">
          <span className="block break-words text-base font-semibold leading-snug">
            {project.name}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            {project.client && <Building2 className="size-3.5 shrink-0" aria-hidden="true" />}
            <span>
              {project.code}
              {project.client && ` · ${project.client.name}`}
            </span>
          </span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          <Chip>{t(`priority.${project.priority}`)}</Chip>
        </span>
        <span className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-3 text-sm text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2">
            {project.lead && (
              <span
                aria-hidden="true"
                className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
              >
                {initials(project.lead.firstName, project.lead.lastName)}
              </span>
            )}
            <span className="truncate">
              {project.lead
                ? t('lead', { name: `${project.lead.firstName} ${project.lead.lastName}` })
                : t('noLead')}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
            {period}
          </span>
        </span>
      </Link>
    </li>
  );
}
