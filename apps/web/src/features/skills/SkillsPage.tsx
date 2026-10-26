import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useOwnEmployee } from '@/features/employees/hooks';
import { useCatalog } from './hooks';
import { cn } from '@/shared/lib/cn';
import { CatalogTab } from './CatalogTab';
import { PeopleTab } from './PeopleTab';
import { RatingEditor } from './RatingEditor';

type Tab = 'mine' | 'people' | 'catalog';

export function SkillsPage() {
  const { t } = useTranslation('skills');
  const [params, setParams] = useSearchParams();
  const own = useOwnEmployee();
  const catalog = useCatalog();
  const canManage = catalog.data?.canManage ?? false;
  const tabs: Tab[] = ['mine', 'people', ...(canManage ? (['catalog'] as const) : [])];
  const requested = tabs.find((x) => x === params.get('tab'));
  const tab: Tab = requested ?? 'mine';

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <div
        role="group"
        aria-label={t('tabs.label')}
        className="flex gap-1 rounded-lg bg-secondary p-1"
      >
        {tabs.map((x) => (
          <button
            key={x}
            type="button"
            aria-pressed={tab === x}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (x === 'mine') next.delete('tab');
              else next.set('tab', x);
              setParams(next, { replace: true });
            }}
            className={cn(
              'min-h-11 flex-1 rounded-md px-2 text-sm font-medium',
              tab === x ? 'bg-surface text-foreground shadow-card' : 'text-muted-foreground',
            )}
          >
            {t(`tabs.${x}`)}
          </button>
        ))}
      </div>
      {tab === 'mine' &&
        (own.data ? (
          <RatingEditor employeeId={own.data.id} />
        ) : own.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('loading')}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noEmployee')}</p>
        ))}
      {tab === 'people' && <PeopleTab />}
      {tab === 'catalog' && canManage && <CatalogTab />}
    </div>
  );
}
