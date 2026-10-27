import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useUnreadCount } from './hooks';

export function NotificationBell() {
  const { t } = useTranslation('notifications');
  const { data } = useUnreadCount();
  const unread = data ?? 0;
  const badge = unread > 99 ? '99+' : String(unread);

  // The bell rings when the count grows after the first answer; the badge pops on every change.
  const [seen, setSeen] = useState<number | undefined>(undefined);
  const [rings, setRings] = useState(0);
  if (data !== undefined && data !== seen) {
    setSeen(data);
    if (seen !== undefined && data > seen) setRings(rings + 1);
  }

  return (
    <Link
      to="/notifications"
      aria-label={t('bell', { count: unread })}
      className="relative flex size-11 items-center justify-center rounded-xl border border-border bg-surface-muted text-foreground transition-colors hover:bg-secondary active:bg-secondary"
    >
      <Bell
        key={rings}
        className={rings > 0 ? 'motion-bell-ring size-5' : 'size-5'}
        aria-hidden="true"
      />
      {unread > 0 && (
        <span
          key={unread}
          aria-hidden="true"
          className="motion-badge-pop absolute right-1 top-1 flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[0.6875rem] font-semibold leading-5 text-danger-foreground"
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
