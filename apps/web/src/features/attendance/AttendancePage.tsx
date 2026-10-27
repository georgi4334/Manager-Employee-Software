import { todayIn } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useCurrentUser } from '@/features/auth/use-auth';
import { usePermission } from '@/features/auth/permissions';
import { HistoryTab } from './HistoryTab';
import { TeamTab } from './TeamTab';
import { TodayTab } from './TodayTab';
import { TabList, TabPanel } from '@/shared/ui/tabs';

type Tab = 'today' | 'history' | 'team';

export function AttendancePage() {
  const { t } = useTranslation('attendance');
  const { data: user } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const canRecord = usePermission('attendance.record');
  const canView = usePermission('attendance.view');
  const seesTeam = usePermission('attendance.view', 'reports');

  const tabs: Tab[] = [
    ...(canRecord ? (['today'] as const) : []),
    ...(canRecord && canView ? (['history'] as const) : []),
    ...(seesTeam ? (['team'] as const) : []),
  ];
  const requested = params.get('tab');
  const tab: Tab | undefined = tabs.find((candidate) => candidate === requested) ?? tabs[0];
  // Dates follow the user's own time zone setting when there is one, else the browser's.
  const zone = user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayIn(zone);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {tabs.length > 1 && (
        <TabList
          label={t('tabs.label')}
          idPrefix="attendance"
          tabs={tabs.map((name) => ({ name, label: t(`tabs.${name}`) }))}
          value={tab ?? ''}
          onChange={(name) => setParams(name === tabs[0] ? {} : { tab: name }, { replace: true })}
        />
      )}
      <TabPanel value={tab ?? ''} idPrefix="attendance">
        {tab === 'today' && <TodayTab />}
        {tab === 'history' && <HistoryTab today={today} />}
        {tab === 'team' && <TeamTab today={today} />}
      </TabPanel>
    </div>
  );
}
