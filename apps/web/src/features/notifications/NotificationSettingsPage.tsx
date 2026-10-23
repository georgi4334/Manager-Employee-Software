import {
  NOTIFICATION_CHANNELS,
  isNotificationType,
  type NotificationChannel,
  type NotificationPreference,
} from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { usePreferences, useUpdatePreference } from './hooks';

/** Name of a notification type for the settings page; unknown (newer) types get a generic name. */
function useTypeTitle() {
  const { t } = useTranslation(['notifications', 'common']);
  return (type: string): string =>
    type === 'account.roles_changed' && isNotificationType(type)
      ? t('types.account.roles_changed.settingsTitle')
      : t('unknown.title');
}

export function NotificationSettingsPage() {
  const { t } = useTranslation(['notifications', 'common']);
  const typeTitle = useTypeTitle();
  const messages = useMessages();
  const preferences = usePreferences();
  const update = useUpdatePreference();

  const toggle = (preference: NotificationPreference, channel: NotificationChannel) => {
    const state = preference.channels[channel];
    if (state.locked || !isNotificationType(preference.type)) return;
    update.mutate({ type: preference.type, channel, enabled: !state.enabled });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('settingsTitle')}</h1>
        <Button asChild variant="secondary">
          <Link to="/notifications">{t('backToInbox')}</Link>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('settingsIntro')}</p>

      {update.isError && <Alert tone="danger">{messages.apiError(update.error)}</Alert>}
      {preferences.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('common:loading')}
        </p>
      )}
      {preferences.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{messages.apiError(preferences.error)}</Alert>
          <Button onClick={() => void preferences.refetch()}>{t('common:retry')}</Button>
        </Card>
      )}

      {preferences.data?.map((preference) => (
        <Card key={preference.type} className="space-y-3">
          <TypeHeading type={preference.type} />
          <ul className="divide-y divide-border">
            {NOTIFICATION_CHANNELS.map((channel) => {
              const state = preference.channels[channel];
              const label = t(`channels.${channel}`);
              return (
                <li key={channel} className="flex min-h-11 items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{label}</span>
                    {state.locked && (
                      <span className="block text-xs text-muted-foreground">{t('required')}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={state.enabled}
                    aria-label={t('switchLabel', {
                      channel: label,
                      type: typeTitle(preference.type),
                    })}
                    disabled={state.locked || update.isPending}
                    onClick={() => toggle(preference, channel)}
                    className="relative h-7 w-12 shrink-0 rounded-full border border-border bg-surface-muted transition-colors disabled:opacity-60 aria-checked:border-primary aria-checked:bg-primary"
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute top-0.5 size-5 rounded-full bg-surface shadow-card transition-all ${state.enabled ? 'left-6' : 'left-0.5'}`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function TypeHeading({ type }: { type: string }) {
  const { t } = useTranslation('notifications');
  if (type === 'account.roles_changed' && isNotificationType(type)) {
    return (
      <div>
        <CardTitle>{t('types.account.roles_changed.settingsTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t('types.account.roles_changed.settingsHelp')}
        </p>
      </div>
    );
  }
  return <CardTitle>{t('unknown.title')}</CardTitle>;
}
