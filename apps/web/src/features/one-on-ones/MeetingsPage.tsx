import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { cn } from '@/shared/lib/cn';
import { PAGE_SIZE } from './api';
import { useMeetingPeople, useMeetings } from './hooks';
import { MeetingCard } from './MeetingCard';
import { ScheduleForm } from './ScheduleForm';
import { useMeetingErrors } from './use-meeting-errors';

const TABS = ['upcoming', 'past', 'all'] as const;

export function MeetingsPage() {
  const { t } = useTranslation('meetings');
  const errors = useMeetingErrors();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const tab = TABS.find((s) => s === params.get('status')) ?? 'upcoming';
  const people = useMeetingPeople();
  const query = useMeetings({ status: tab, page });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const canSchedule = (people.data?.items.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {canSchedule && !creating && <Button onClick={() => setCreating(true)}>{t('new')}</Button>}
      {people.isSuccess && !canSchedule && (
        <Card>
          <p className="text-sm text-muted-foreground">{t('nobody')}</p>
        </Card>
      )}
      {creating && people.data && (
        <Card className="space-y-3">
          <h2 className="text-base font-semibold">{t('form.title')}</h2>
          <ScheduleForm
            people={people.data.items}
            onDone={(id) => {
              setCreating(false);
              if (id) void navigate(`/one-on-ones/${id}`);
            }}
          />
        </Card>
      )}

      <div
        role="group"
        aria-label={t('tabs.label')}
        className="flex gap-1 rounded-lg bg-secondary p-1"
      >
        {TABS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={tab === s}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (s === 'upcoming') next.delete('status');
              else next.set('status', s);
              setParams(next, { replace: true });
              setPage(1);
            }}
            className={cn(
              'min-h-11 flex-1 rounded-md px-2 text-sm font-medium',
              tab === s ? 'bg-surface text-foreground shadow-card' : 'text-muted-foreground',
            )}
          >
            {t(`tabs.${s}`)}
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
      {data &&
        (data.items.length === 0 ? (
          <Card>
            <p className="text-center text-sm text-muted-foreground">{t('empty')}</p>
          </Card>
        ) : (
          <>
            <ul className="space-y-2" aria-label={t('title')}>
              {data.items.map((m) => (
                <MeetingCard key={m.id} meeting={m} />
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
