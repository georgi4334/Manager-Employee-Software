import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { cn } from '@/shared/lib/cn';
import { ChatTab } from './ChatTab';
import { useAiStatus } from './hooks';
import { SettingsTab } from './SettingsTab';

type Tab = 'chat' | 'settings';
const TABS: Tab[] = ['chat', 'settings'];

export function AssistantPage() {
  const { t } = useTranslation('assistant');
  const messages = useMessages();
  const [params, setParams] = useSearchParams();
  const status = useAiStatus();
  const tab: Tab = TABS.find((x) => x === params.get('tab')) ?? 'chat';
  const select = (next: Tab) => {
    const p = new URLSearchParams(params);
    if (next === 'chat') p.delete('tab');
    else p.set('tab', next);
    setParams(p, { replace: true });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <div
        role="group"
        aria-label={t('tabs.label')}
        className="flex gap-1 rounded-lg bg-secondary p-1"
      >
        {TABS.map((x) => (
          <button
            key={x}
            type="button"
            aria-pressed={tab === x}
            onClick={() => select(x)}
            className={cn(
              'min-h-11 flex-1 rounded-md px-2 text-sm font-medium',
              tab === x ? 'bg-surface text-foreground shadow-card' : 'text-muted-foreground',
            )}
          >
            {t(`tabs.${x}`)}
          </button>
        ))}
      </div>
      {status.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {status.isError && <Alert tone="danger">{messages.apiError(status.error)}</Alert>}
      {status.data &&
        (tab === 'chat' ? (
          <ChatTab status={status.data} onOpenSettings={() => select('settings')} />
        ) : (
          <SettingsTab status={status.data} />
        ))}
    </div>
  );
}
