import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { ChartTab } from './ChartTab';
import { DepartmentsTab } from './DepartmentsTab';
import { TeamsTab } from './TeamsTab';

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
      <div
        role="tablist"
        aria-label={t('tabs.label')}
        className="flex gap-1 rounded-lg bg-secondary p-1"
      >
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`org-tab-${name}`}
            aria-selected={tab === name}
            aria-controls="org-panel"
            onClick={() => setParams(name === 'chart' ? {} : { tab: name }, { replace: true })}
            className={cn(
              'min-h-11 flex-1 rounded-md px-3 text-sm font-medium',
              tab === name ? 'bg-surface text-foreground shadow-card' : 'text-muted-foreground',
            )}
          >
            {t(`tabs.${name}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="org-panel" aria-labelledby={`org-tab-${tab}`}>
        {tab === 'chart' && <ChartTab />}
        {tab === 'departments' && <DepartmentsTab />}
        {tab === 'teams' && <TeamsTab />}
      </div>
    </div>
  );
}
