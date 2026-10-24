import { todayIn } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useCurrentUser } from '@/features/auth/use-auth';
import { usePermission } from '@/features/auth/permissions';
import { cn } from '@/shared/lib/cn';
import { HistoryTab } from './HistoryTab';
import { TeamTab } from './TeamTab';
import { TodayTab } from './TodayTab';

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
              id={`attendance-tab-${name}`}
              aria-selected={tab === name}
              aria-controls="attendance-panel"
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
      <div
        role="tabpanel"
        id="attendance-panel"
        aria-labelledby={tab ? `attendance-tab-${tab}` : undefined}
      >
        {tab === 'today' && <TodayTab />}
        {tab === 'history' && <HistoryTab today={today} />}
        {tab === 'team' && <TeamTab today={today} />}
      </div>
    </div>
  );
}
