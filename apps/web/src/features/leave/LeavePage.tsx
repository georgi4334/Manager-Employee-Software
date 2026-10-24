import { todayIn, yearOf } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useCurrentUser } from '@/features/auth/use-auth';
import { usePermission } from '@/features/auth/permissions';
import { cn } from '@/shared/lib/cn';
import { ApprovalsTab } from './ApprovalsTab';
import { MyLeaveTab } from './MyLeaveTab';
import { SettingsTab } from './SettingsTab';
import { TeamTab } from './TeamTab';

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
        <div
          role="tablist"
          aria-label={t('tabs.label')}
          className="flex gap-1 overflow-x-auto rounded-lg bg-secondary p-1"
        >
          {tabs.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`leave-tab-${name}`}
              aria-selected={tab === name}
              aria-controls="leave-panel"
              onClick={() => setParams(name === tabs[0] ? {} : { tab: name }, { replace: true })}
              className={cn(
                'min-h-11 flex-1 whitespace-nowrap rounded-md px-3 text-sm font-medium',
                tab === name ? 'bg-surface text-foreground shadow-card' : 'text-muted-foreground',
              )}
            >
              {t(`tabs.${name}`)}
            </button>
          ))}
        </div>
      )}
      <div role="tabpanel" id="leave-panel" aria-labelledby={tab ? `leave-tab-${tab}` : undefined}>
        {tab === 'my' && <MyLeaveTab currentYear={yearOf(today)} />}
        {tab === 'approvals' && <ApprovalsTab />}
        {tab === 'team' && <TeamTab today={today} />}
        {tab === 'settings' && <SettingsTab currentYear={yearOf(today)} />}
      </div>
    </div>
  );
}
