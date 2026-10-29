import type { NotificationItem } from '@intime/contracts';
import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { safeRedirectPath } from '@/features/auth/redirect';
import { formatDate } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { useMessages } from '@/features/auth/messages';
import { useMarkAllRead, useMarkRead, useNotifications } from './hooks';
import { NotificationText } from './NotificationText';

export function NotificationsPage() {
  const { t, i18n } = useTranslation(['notifications', 'common']);
  const messages = useMessages();
  const navigate = useNavigate();
  const query = useNotifications();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const unread = query.data?.pages[0]?.unreadCount ?? 0;
  const language = i18n.resolvedLanguage ?? 'en';

  const open = (item: NotificationItem) => {
    if (!item.readAt) markRead.mutate(item.id);
    // Links come from the server; only same-site paths are followed.
    void navigate(safeRedirectPath(item.link, '/notifications'));
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={unread === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            {t('markAllRead')}
          </Button>
          <Button asChild variant="ghost" size="icon">
            <Link to="/notifications/settings" aria-label={t('settings')} title={t('settings')}>
              <Settings className="size-5" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>

      {(markRead.isError || markAllRead.isError) && (
        <Alert tone="danger">{messages.apiError(markRead.error ?? markAllRead.error)}</Alert>
      )}

      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('common:loading')}
        </p>
      )}

      {query.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{messages.apiError(query.error)}</Alert>
          <Button onClick={() => void query.refetch()}>{t('common:retry')}</Button>
        </Card>
      )}

      {query.isSuccess && items.length === 0 && (
        <Card>
          <p className="text-center text-sm text-muted-foreground">{t('empty')}</p>
        </Card>
      )}

      {items.length > 0 && (
        <ul className="space-y-2" aria-label={t('title')}>
          {items.map((item) => {
            const isUnread = item.readAt === null;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => open(item)}
                  className={cn(
                    'flex min-h-14 w-full items-start gap-3 rounded-xl glass p-4 text-left',
                    isUnread ? 'bg-accent text-accent-foreground' : 'glass-hover',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-1.5 size-2.5 shrink-0 rounded-full',
                      isUnread ? 'bg-primary' : 'bg-transparent',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <NotificationText type={item.type} params={item.params} onAccent={isUnread} />
                    <time
                      dateTime={item.createdAt}
                      className={cn('mt-1 block text-xs', !isUnread && 'text-muted-foreground')}
                    >
                      {formatDate(item.createdAt, language, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </time>
                  </span>
                  {isUnread && <span className="sr-only">{t('unread')}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {query.hasNextPage && (
        <div className="text-center">
          <Button
            variant="secondary"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
