import { Bell, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { usePresence } from '@/shared/lib/motion';
import { useUnreadCount } from './hooks';

const VISIBLE_MS = 6000;

/** Slides in from the top when the unread count grows while the app is open (not on first load). */
export function NotificationToast() {
  const { t } = useTranslation('notifications');
  const { data: unread } = useUnreadCount();
  const { pathname } = useLocation();
  const [seen, setSeen] = useState<number | undefined>(undefined);
  const [added, setAdded] = useState(1);
  const [open, setOpen] = useState(false);
  const presence = usePresence(open);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  if (unread !== undefined && unread !== seen) {
    setSeen(unread);
    if (seen !== undefined && unread > seen && pathname !== '/notifications') {
      setAdded(unread - seen);
      setOpen(true);
    }
  }

  useEffect(() => {
    if (!open) return;
    timer.current = setTimeout(() => setOpen(false), VISIBLE_MS);
    return () => clearTimeout(timer.current);
    // A newer notification restarts the countdown.
  }, [open, added, seen]);

  if (!presence.mounted) return null;

  return (
    <div
      role="status"
      data-state={presence.state}
      className="motion-toast fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-50 mx-auto flex max-w-sm items-center gap-3 rounded-xl border border-border bg-surface p-2 pl-4 shadow-card"
    >
      <Bell className="size-5 shrink-0 text-primary" aria-hidden="true" />
      <p className="flex-1 text-sm font-medium">{t('toast', { count: added })}</p>
      <Link
        to="/notifications"
        onClick={() => setOpen(false)}
        className="flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-primary hover:bg-surface-muted"
      >
        {t('toastView')}
      </Link>
      <button
        type="button"
        aria-label={t('toastDismiss')}
        onClick={() => setOpen(false)}
        className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted"
      >
        <X className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
}
