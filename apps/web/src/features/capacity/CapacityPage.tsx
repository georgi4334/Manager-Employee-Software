import { addDays, todayIn, weekStartOf } from '@intime/contracts';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useProjects } from '@/features/projects/hooks';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { Skeleton, SkeletonGroup } from '@/shared/ui/skeleton';
import { formatDay } from '@/shared/lib/format';
import { PAGE_SIZE } from './api';
import { useCapacity } from './hooks';
import { PersonCard } from './PersonCard';

export function CapacityPage() {
  const { t, i18n } = useTranslation('capacity');
  const language = i18n.resolvedLanguage ?? 'en';
  const messages = useMessages();
  const { data: user } = useCurrentUser();
  const today = todayIn(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [weekStart, setWeekStart] = useState(weekStartOf(today));
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [projectId, setProjectId] = useState('');
  const [mostFree, setMostFree] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const projects = useProjects({ q: '', status: 'all', clientId: '', page: 1 });
  const query = useCapacity({ from: weekStart, to: addDays(weekStart, 6), projectId, q, page });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const items = data
    ? mostFree
      ? [...data.items].sort((a, b) => b.freeMinutes - a.freeMinutes)
      : data.items
    : [];
  const moveWeek = (days: number) => {
    setWeekStart(addDays(weekStart, days));
    setPage(1);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('standardDay')}</p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" onClick={() => moveWeek(-7)}>
          {t('week.previous')}
        </Button>
        <h2 className="text-base font-semibold" aria-live="polite">
          {t('week.of', { date: formatDay(weekStart, language) })}
        </h2>
        <Button variant="secondary" onClick={() => moveWeek(7)}>
          {t('week.next')}
        </Button>
        {weekStart !== weekStartOf(today) && (
          <Button variant="ghost" onClick={() => setWeekStart(weekStartOf(today))}>
            {t('week.thisWeek')}
          </Button>
        )}
      </div>

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
          className="sm:w-56"
          aria-label={t('project')}
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('allProjects')}</option>
          {(projects.data?.items ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </Select>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={mostFree}
          onChange={(e) => setMostFree(e.target.checked)}
        />
        {t('mostFree')}
      </label>

      {query.isPending && (
        <SkeletonGroup label={t('loading')} className="space-y-3">
          {[0, 1, 2].map((n) => (
            <div key={n} className="space-y-4 rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-11 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-2.5 w-full rounded-full" />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[0, 1, 2, 3].map((m) => (
                  <Skeleton key={m} className="h-12 rounded-lg" />
                ))}
              </div>
            </div>
          ))}
        </SkeletonGroup>
      )}
      {query.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{messages.apiError(query.error)}</Alert>
          <Button onClick={() => void query.refetch()}>{t('retry')}</Button>
        </Card>
      )}
      {data &&
        (items.length === 0 ? (
          <Card>
            <p className="text-center text-sm text-muted-foreground">{t('empty')}</p>
          </Card>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t('total', { count: data.total })}
            </p>
            <ul className="space-y-2" aria-label={t('title')}>
              {items.map((person) => (
                <PersonCard key={person.employee.id} person={person} />
              ))}
            </ul>
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
        ))}
    </div>
  );
}
