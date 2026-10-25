import { TASK_STATUSES, TASK_TYPES } from '@intime/contracts';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePermission } from '@/features/auth/permissions';
import { useProjects } from '@/features/projects/hooks';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { cn } from '@/shared/lib/cn';
import { PAGE_SIZE, type ListParams } from './api';
import { useTasks } from './hooks';
import { TaskCard } from './TaskCard';
import { TaskForm } from './TaskForm';
import { useTaskErrors } from './use-task-errors';

type View = 'list' | 'board';

export function TasksPage() {
  const { t } = useTranslation('tasks');
  const errors = useTaskErrors();
  const [params, setParams] = useSearchParams();
  const canCreate = usePermission('task.manage');
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [status, setStatus] = useState<ListParams['status']>('open');
  const [type, setType] = useState<ListParams['type']>('all');
  const [page, setPage] = useState(1);
  const projectId = params.get('project') ?? '';
  const view: View = params.get('view') === 'board' ? 'board' : 'list';
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  };

  const projects = useProjects({ q: '', status: 'all', clientId: '', page: 1 });
  const query = useTasks({ projectId, mine, status, type, q, page });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const editable = (projects.data?.items ?? []).filter((p) => p.canEdit);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {canCreate && editable.length > 0 && !creating && (
        <Button onClick={() => setCreating(true)}>{t('new')}</Button>
      )}
      {creating && (
        <Card className="space-y-3">
          <h2 className="text-base font-semibold">{t('form.newTitle')}</h2>
          <TaskForm
            projects={editable}
            defaultProjectId={projectId}
            onDone={() => setCreating(false)}
          />
        </Card>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-4">
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
          aria-label={t('filters.project')}
          value={projectId}
          onChange={(e) => setParam('project', e.target.value)}
        >
          <option value="">{t('filters.allProjects')}</option>
          {(projects.data?.items ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('filters.status')}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ListParams['status']);
            setPage(1);
          }}
        >
          <option value="all">{t('filters.allStatuses')}</option>
          <option value="open">{t('filters.open')}</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('filters.type')}
          value={type}
          onChange={(e) => {
            setType(e.target.value as ListParams['type']);
            setPage(1);
          }}
        >
          <option value="all">{t('filters.allTypes')}</option>
          {TASK_TYPES.map((v) => (
            <option key={v} value={v}>
              {t(`type.${v}`)}
            </option>
          ))}
        </Select>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={mine}
            onChange={(e) => {
              setMine(e.target.checked);
              setPage(1);
            }}
          />
          {t('filters.mine')}
        </label>
      </div>

      <div
        role="group"
        aria-label={t('views.label')}
        className="flex gap-1 rounded-lg bg-secondary p-1"
      >
        {(['list', 'board'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setParam('view', v === 'list' ? '' : v)}
            className={cn(
              'min-h-11 flex-1 rounded-md px-3 text-sm font-medium',
              view === v ? 'bg-surface text-foreground shadow-card' : 'text-muted-foreground',
            )}
          >
            {t(`views.${v}`)}
          </button>
        ))}
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
          ) : view === 'list' ? (
            <ul className="space-y-2" aria-label={t('title')}>
              {data.items.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </ul>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {TASK_STATUSES.map((s) => {
                const column = data.items.filter((task) => task.status === s);
                return (
                  <section key={s} aria-labelledby={`board-${s}`} className="space-y-2">
                    <h2 id={`board-${s}`} className="text-sm font-semibold">
                      {t(`status.${s}`)} ({column.length})
                    </h2>
                    <ul className="space-y-2" aria-labelledby={`board-${s}`}>
                      {column.map((task) => (
                        <TaskCard key={task.id} task={task} />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
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
