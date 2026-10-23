import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useUnreadCount } from './hooks';

export function NotificationBell() {
  const { t } = useTranslation('notifications');
  const { data: unread = 0 } = useUnreadCount();
  const badge = unread > 99 ? '99+' : String(unread);

  return (
    <Link
      to="/notifications"
      aria-label={t('bell', { count: unread })}
      className="relative flex size-11 items-center justify-center rounded-md text-foreground hover:bg-surface-muted"
    >
      <Bell className="size-5" aria-hidden="true" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[0.6875rem] font-semibold leading-5 text-danger-foreground"
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
