import { todayIn } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useCurrentUser } from '@/features/auth/use-auth';
import { ApprovalsTab } from './ApprovalsTab';
import { ReportsTab } from './ReportsTab';
import { WeekTab } from './WeekTab';
import { TabList, TabPanel } from '@/shared/ui/tabs';
import { useVisibleSections } from '@/app/sections';

type Tab = 'week' | 'approvals' | 'reports';

export function TimePage() {
  const { t } = useTranslation('time');
  const { data: user } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const tabs: Tab[] = useVisibleSections('/time');
  const requested = params.get('tab');
  const tab: Tab | undefined = tabs.find((candidate) => candidate === requested) ?? tabs[0];
  const today = todayIn(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {tabs.length > 1 && (
        <TabList
          label={t('tabs.label')}
          idPrefix="time"
          tabs={tabs.map((name) => ({ name, label: t(`tabs.${name}`) }))}
          value={tab ?? ''}
          onChange={(name) => setParams(name === tabs[0] ? {} : { tab: name }, { replace: true })}
        />
      )}
      <TabPanel value={tab ?? ''} idPrefix="time">
        {tab === 'week' && <WeekTab today={today} />}
        {tab === 'approvals' && <ApprovalsTab />}
        {tab === 'reports' && <ReportsTab today={today} />}
      </TabPanel>
    </div>
  );
}
