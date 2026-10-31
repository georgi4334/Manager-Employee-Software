import type { ReviewBox } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useCurrentUser } from '@/features/auth/use-auth';
import { usePermission } from '@/features/auth/permissions';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Select } from '@/shared/ui/select';
import { Skeleton, SkeletonGroup } from '@/shared/ui/skeleton';
import { PAGE_SIZE } from './api';
import { CyclesTab } from './CyclesTab';
import { useCycles, useReviews } from './hooks';
import { ReviewCard } from './ReviewCard';
import { useReviewErrors } from './use-review-errors';
import { TabList, TabContent } from '@/shared/ui/tabs';

type Tab = ReviewBox | 'cycles';

export function ReviewsPage() {
  const { t } = useTranslation('reviews');
  const errors = useReviewErrors();
  const [params, setParams] = useSearchParams();
  const me = useCurrentUser();
  const scope = me.data?.permissions['review.view'];
  const manages = usePermission('review.manage_cycles');
  const tabs: Tab[] = [
    'mine',
    ...(scope === 'reports' || scope === 'all' ? (['team'] as const) : []),
    ...(scope === 'all' ? (['all'] as const) : []),
    ...(manages ? (['cycles'] as const) : []),
  ];
  const requested = tabs.find((x) => x === params.get('tab'));
  const tab: Tab = requested ?? 'mine';
  const cycleId = params.get('cycle') ?? '';
  const [page, setPage] = useState(1);
  const cycles = useCycles();
  const box: ReviewBox = tab === 'cycles' ? 'mine' : tab;
  const query = useReviews({ box, cycleId, page }, tab !== 'cycles');
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const go = (next: Tab, cycle = '') => {
    const p = new URLSearchParams();
    if (next !== 'mine') p.set('tab', next);
    if (cycle) p.set('cycle', cycle);
    setParams(p, { replace: true });
    setPage(1);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {tabs.length > 1 && (
        <TabList
          mode="toggle"
          label={t('tabs.label')}
          tabs={tabs.map((name) => ({ name, label: t(`tabs.${name}`) }))}
          value={tab}
          onChange={(name) => go(name as Tab)}
        />
      )}

      <TabContent value={tab}>
        {tab === 'cycles' ? (
          <CyclesTab onShowReviews={(id) => go('all', id)} />
        ) : (
          <>
            {tab !== 'mine' && (
              <Select
                className="sm:max-w-xs"
                aria-label={t('filters.cycle')}
                value={cycleId}
                onChange={(e) => {
                  go(tab, e.target.value);
                }}
              >
                <option value="">{t('filters.allCycles')}</option>
                {(cycles.data?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
            {query.isPending && (
              <SkeletonGroup label={t('loading')} className="grid gap-4 sm:grid-cols-2">
                {[0, 1, 2, 3].map((n) => (
                  <Skeleton key={n} className="h-52 rounded-xl" />
                ))}
              </SkeletonGroup>
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
                  <p className="text-center text-sm text-muted-foreground">{t(`empty.${box}`)}</p>
                </Card>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground" aria-live="polite">
                    {t('total', { count: data.total })}
                  </p>
                  <ul className="grid gap-4 sm:grid-cols-2" aria-label={t(`tabs.${box}`)}>
                    {data.items.map((r) => (
                      <ReviewCard key={r.id} review={r} showEmployee={box !== 'mine'} />
                    ))}
                  </ul>
                  {pages > 1 && (
                    <nav
                      className="flex items-center justify-between gap-2"
                      aria-label={t('pagination')}
                    >
                      <Button
                        variant="secondary"
                        disabled={page <= 1}
                        onClick={() => setPage(page - 1)}
                      >
                        {t('previous')}
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        {t('page', { page, pages })}
                      </span>
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
          </>
        )}
      </TabContent>
    </div>
  );
}
