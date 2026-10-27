import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useOwnEmployee } from '@/features/employees/hooks';
import { useCatalog } from './hooks';
import { CatalogTab } from './CatalogTab';
import { PeopleTab } from './PeopleTab';
import { RatingEditor } from './RatingEditor';
import { TabList, TabContent } from '@/shared/ui/tabs';

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
      <TabList
        mode="toggle"
        label={t('tabs.label')}
        tabs={tabs.map((name) => ({ name, label: t(`tabs.${name}`) }))}
        value={tab}
        onChange={(name) => {
          const next = new URLSearchParams(params);
          if (name === 'mine') next.delete('tab');
          else next.set('tab', name);
          setParams(next, { replace: true });
        }}
      />
      <TabContent value={tab}>
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
      </TabContent>
    </div>
  );
}
