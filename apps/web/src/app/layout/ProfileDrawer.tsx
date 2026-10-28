import { ChevronDown, LogOut, UserRound, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCurrentUser, useSignOut } from '@/features/auth/use-auth';
import { LanguageSwitcher } from '@/shared/components/LanguageSwitcher';
import { ThemeMenu } from '@/shared/components/ThemeMenu';
import { usePresence } from '@/shared/lib/motion';
import { Button } from '@/shared/ui/button';

const FOCUSABLE =
  'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The profile button of the header and the drawer behind it: profile, language, theme, sign out. */
export function ProfileDrawer() {
  const { t } = useTranslation('common');
  const { data: user } = useCurrentUser();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const presence = usePresence(open);

  // Keyboard and focus: move into the drawer, give the focus back to the button when it closes.
  useEffect(() => {
    if (!open) return;
    const button = trigger.current;
    closeButton.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      button?.focus();
    };
  }, [open]);

  if (!user) return null;

  // Keep Tab inside the drawer while it is open.
  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const name = user.email.split('@')[0] ?? user.email;
  const role = user.roles[0]?.name;
  const who = [user.workspace.name, user.roles.map((role) => role.name).join(', ')]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('accountMenu')}
        title={t('accountMenu')}
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-3 rounded-xl p-1 transition-colors hover:bg-surface-muted active:scale-[0.97] md:pr-2"
      >
        <span
          aria-hidden="true"
          className="grid size-9 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
        >
          {name.slice(0, 2).toUpperCase()}
        </span>
        <span aria-hidden="true" className="hidden text-left md:block">
          <span className="block max-w-44 truncate text-sm font-semibold leading-tight">
            {name}
          </span>
          {role && (
            <span className="block max-w-44 truncate text-xs text-muted-foreground">{role}</span>
          )}
        </span>
        <ChevronDown className="hidden size-4 text-muted-foreground md:block" aria-hidden="true" />
      </button>
      {presence.mounted &&
        // On the page body, not inside the header: the header is its own stacking context and the
        // bottom navigation would otherwise cover the drawer on phones.
        createPortal(
          <>
            <div
              aria-hidden="true"
              data-state={presence.state}
              className="motion-fade fixed inset-0 z-40 bg-foreground/40"
              onClick={() => setOpen(false)}
            />
            <div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              data-state={presence.state}
              onKeyDown={trapTab}
              className="motion-sheet-right fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col rounded-l-3xl bg-surface shadow-card"
            >
              <div className="flex items-start justify-between gap-3 border-b border-border p-4">
                <div className="min-w-0">
                  <h2 id={titleId} className="truncate text-base font-semibold">
                    {user.email}
                  </h2>
                  {who && <p className="truncate text-sm text-muted-foreground">{who}</p>}
                </div>
                <Button
                  ref={closeButton}
                  variant="ghost"
                  size="icon"
                  aria-label={t('close')}
                  onClick={() => setOpen(false)}
                >
                  <X className="size-5" aria-hidden="true" />
                </Button>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto p-4">
                <Link
                  to="/profile"
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 text-sm font-medium hover:bg-surface-muted"
                >
                  <UserRound className="size-5" aria-hidden="true" />
                  {t('profile')}
                </Link>
                <LanguageSwitcher showLabel />
                <ThemeMenu />
              </div>

              <div className="border-t border-border p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={signOut.isPending}
                  onClick={() => signOut.mutate()}
                >
                  <LogOut className="size-5" aria-hidden="true" />
                  {t('signOut')}
                </Button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
