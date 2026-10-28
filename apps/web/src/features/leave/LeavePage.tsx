import { todayIn, yearOf } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useCurrentUser } from '@/features/auth/use-auth';
import { usePermission } from '@/features/auth/permissions';
import { ApprovalsTab } from './ApprovalsTab';
import { MyLeaveTab } from './MyLeaveTab';
import { SettingsTab } from './SettingsTab';
import { TeamTab } from './TeamTab';
import { TabList, TabPanel } from '@/shared/ui/tabs';

type Tab = 'my' | 'approvals' | 'team' | 'settings';

export function LeavePage() {
  const { t } = useTranslation('leave');
  const { data: user } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const canRequest = usePermission('leave.request');
  const canApprove = usePermission('leave.approve');
  const seesTeam = usePermission('leave.view', 'reports');
  const canManage = usePermission('leave.manage_types_policies');

  const tabs: Tab[] = [
    ...(canRequest ? (['my'] as const) : []),
    ...(canApprove ? (['approvals'] as const) : []),
    ...(seesTeam ? (['team'] as const) : []),
    ...(canManage ? (['settings'] as const) : []),
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
          idPrefix="leave"
          tabs={tabs.map((name) => ({ name, label: t(`tabs.${name}`) }))}
          value={tab ?? ''}
          onChange={(name) => setParams(name === tabs[0] ? {} : { tab: name }, { replace: true })}
        />
      )}
      <TabPanel value={tab ?? ''} idPrefix="leave">
        {tab === 'my' && <MyLeaveTab currentYear={yearOf(today)} />}
        {tab === 'approvals' && <ApprovalsTab />}
        {tab === 'team' && <TeamTab today={today} />}
        {tab === 'settings' && <SettingsTab currentYear={yearOf(today)} />}
      </TabPanel>
    </div>
  );
}
