import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ChartTab } from './ChartTab';
import { DepartmentsTab } from './DepartmentsTab';
import { TeamsTab } from './TeamsTab';
import { TabList, TabPanel } from '@/shared/ui/tabs';

const TABS = ['chart', 'departments', 'teams'] as const;
type Tab = (typeof TABS)[number];

export function OrganizationPage() {
  const { t } = useTranslation('organization');
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: Tab = TABS.find((candidate) => candidate === requested) ?? 'chart';

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <TabList
        label={t('tabs.label')}
        idPrefix="org"
        tabs={TABS.map((name) => ({ name, label: t(`tabs.${name}`) }))}
        value={tab ?? ''}
        onChange={(name) => setParams(name === 'chart' ? {} : { tab: name }, { replace: true })}
      />
      <TabPanel value={tab ?? ''} idPrefix="org">
        {tab === 'chart' && <ChartTab />}
        {tab === 'departments' && <DepartmentsTab />}
        {tab === 'teams' && <TeamsTab />}
      </TabPanel>
    </div>
  );
}
