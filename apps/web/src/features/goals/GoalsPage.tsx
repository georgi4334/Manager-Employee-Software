import { GOAL_SCOPES, GOAL_STATUSES, type GoalScope } from '@intime/contracts';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { usePermission } from '@/features/auth/permissions';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { PAGE_SIZE, type ListParams } from './api';
import { GoalCard } from './GoalCard';
import { GoalForm } from './GoalForm';
import { useGoals, useGoalTeams } from './hooks';
import { useGoalErrors } from './use-goal-errors';
import { TabList } from '@/shared/ui/tabs';

const SCOPE_FILTERS = ['all', ...GOAL_SCOPES] as const;

export function GoalsPage() {
  const { t } = useTranslation('goals');
  const errors = useGoalErrors();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canPersonal = usePermission('goal.manage_personal');
  const canTeam = usePermission('goal.manage_team');
  const canCompany = usePermission('goal.manage_company');
  const teams = useGoalTeams();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ListParams['status']>('open');
  const [page, setPage] = useState(1);
  const scopeParam = params.get('scope');
  const scope: ListParams['scope'] = SCOPE_FILTERS.find((s) => s === scopeParam) ?? 'all';

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useGoals({ scope, status, q, page });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  // Cosmetic: the server decides. A team goal can only be set for a team the caller may manage.
  const scopes = useMemo(() => {
    const list: GoalScope[] = [];
    if (canPersonal) list.push('personal');
    if (canTeam && (teams.data?.items.length ?? 0) > 0) list.push('team');
    if (canCompany) list.push('company');
    return list;
  }, [canPersonal, canTeam, canCompany, teams.data]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {scopes.length > 0 && !creating && (
        <Button onClick={() => setCreating(true)}>{t('new')}</Button>
      )}
      {creating && (
        <Card className="space-y-3">
          <h2 className="text-base font-semibold">{t('form.newTitle')}</h2>
          <GoalForm
            scopes={scopes}
            onDone={(id) => {
              setCreating(false);
              if (id) void navigate(`/goals/${id}`);
            }}
          />
        </Card>
      )}

      <TabList
        mode="toggle"
        label={t('filters.scope')}
        tabs={SCOPE_FILTERS.map((name) => ({
          name,
          label: name === 'all' ? t('filters.allScopes') : t(`scope.${name}`),
        }))}
        value={scope}
        onChange={(name) => {
          const next = new URLSearchParams(params);
          if (name === 'all') next.delete('scope');
          else next.set('scope', name);
          setParams(next, { replace: true });
          setPage(1);
        }}
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="relative">
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
          aria-label={t('filters.status')}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ListParams['status']);
            setPage(1);
          }}
        >
          <option value="all">{t('filters.allStatuses')}</option>
          <option value="open">{t('filters.open')}</option>
          {GOAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
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
              {data.items.map((goal) => (
                <GoalCard key={goal.id} goal={goal} />
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
