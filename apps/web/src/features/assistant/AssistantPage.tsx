import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { ChatTab } from './ChatTab';
import { useAiStatus } from './hooks';
import { SettingsTab } from './SettingsTab';
import { TabList, TabContent } from '@/shared/ui/tabs';

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
      <TabList
        mode="toggle"
        label={t('tabs.label')}
        tabs={TABS.map((name) => ({ name, label: t(`tabs.${name}`) }))}
        value={tab}
        onChange={(name) => select(name as Tab)}
      />
      <TabContent value={tab}>
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
      </TabContent>
    </div>
  );
}
