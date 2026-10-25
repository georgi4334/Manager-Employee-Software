import { todayIn } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePermission } from '@/features/auth/permissions';
import { useCurrentUser } from '@/features/auth/use-auth';
import { cn } from '@/shared/lib/cn';
import { ApprovalsTab } from './ApprovalsTab';
import { WeekTab } from './WeekTab';

type Tab = 'week' | 'approvals';

export function TimePage() {
  const { t } = useTranslation('time');
  const { data: user } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const seesWeek = usePermission(['time.log', 'time.view']);
  const approves = usePermission('timesheet.approve');
  const tabs: Tab[] = [
    ...(seesWeek ? (['week'] as const) : []),
    ...(approves ? (['approvals'] as const) : []),
  ];
  const requested = params.get('tab');
  const tab: Tab | undefined = tabs.find((candidate) => candidate === requested) ?? tabs[0];
  const today = todayIn(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);

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
              id={`time-tab-${name}`}
              aria-selected={tab === name}
              aria-controls="time-panel"
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
      <div role="tabpanel" id="time-panel" aria-labelledby={tab ? `time-tab-${tab}` : undefined}>
        {tab === 'week' && <WeekTab today={today} />}
        {tab === 'approvals' && <ApprovalsTab />}
      </div>
    </div>
  );
}
