import { Menu, X } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { usePresence } from '@/shared/lib/motion';
import { useNavItems } from '../useNavItems';

export function BottomNav() {
  const { t } = useTranslation(['common', 'nav']);
  const items = useNavItems();
  const moreItems = items.filter((item) => !item.primary);
  const [menuOpen, setMenuOpen] = useState(false);
  const presence = usePresence(menuOpen);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors duration-300 active:scale-95',
      isActive ? 'text-primary' : 'text-muted-foreground',
    );

  return (
    <div className="md:hidden">
      <nav
        aria-label={t('common:mobileNavigation')}
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        {items
          .filter((item) => item.primary)
          .map(({ path, labelKey, icon: Icon }) => (
            <NavLink key={path} to={path} end={path === '/'} className={linkClass}>
              <Icon className="size-5" aria-hidden="true" />
              <span className="max-w-full truncate px-1">{t(`nav:${labelKey}`)}</span>
            </NavLink>
          ))}
        {moreItems.length > 0 && (
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="more-menu"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground"
          >
            <span className="relative size-5">
              <Menu
                className={cn(
                  'absolute inset-0 size-5 transition-[opacity,transform] duration-300 ease-[var(--ease-ios)]',
                  menuOpen && 'rotate-90 opacity-0',
                )}
                aria-hidden="true"
              />
              <X
                className={cn(
                  'absolute inset-0 size-5 transition-[opacity,transform] duration-300 ease-[var(--ease-ios)]',
                  !menuOpen && '-rotate-90 opacity-0',
                )}
                aria-hidden="true"
              />
            </span>
            <span>{t('common:more')}</span>
          </button>
        )}
      </nav>

      {presence.mounted && moreItems.length > 0 && (
        <>
          <div
            aria-hidden="true"
            data-state={presence.state}
            className="motion-fade fixed inset-0 z-20 bg-foreground/30"
            onClick={() => setMenuOpen(false)}
          />
          <div
            id="more-menu"
            role="dialog"
            aria-modal="true"
            aria-label={t('common:moreNavigation')}
            data-state={presence.state}
            className="motion-sheet-up fixed inset-x-0 bottom-14 z-20 rounded-t-2xl border-t border-border bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-card"
          >
            <ul className="motion-stagger grid gap-1">
              {moreItems.map(({ path, labelKey, icon: Icon }, index) => (
                <li key={path} style={{ '--i': index } as CSSProperties}>
                  <NavLink
                    to={path}
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors hover:bg-surface-muted active:bg-surface-muted"
                  >
                    <Icon className="size-5" aria-hidden="true" />
                    {t(`nav:${labelKey}`)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
