import { todayIn } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePermission } from '@/features/auth/permissions';
import { useCurrentUser } from '@/features/auth/use-auth';
import { ApprovalsTab } from './ApprovalsTab';
import { ReportsTab } from './ReportsTab';
import { WeekTab } from './WeekTab';
import { TabList, TabPanel } from '@/shared/ui/tabs';

type Tab = 'week' | 'approvals' | 'reports';

export function TimePage() {
  const { t } = useTranslation('time');
  const { data: user } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const seesWeek = usePermission(['time.log', 'time.view']);
  const approves = usePermission('timesheet.approve');
  const reportsByProject = usePermission('time.report_project');
  const reportsByPerson = usePermission('time.view', 'reports');
  const reports = reportsByProject || reportsByPerson;
  const tabs: Tab[] = [
    ...(seesWeek ? (['week'] as const) : []),
    ...(approves ? (['approvals'] as const) : []),
    ...(reports ? (['reports'] as const) : []),
  ];
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
