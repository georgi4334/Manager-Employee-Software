import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { NAV_ITEMS } from '../nav';

export function BottomNav() {
  const [menuOpen, setMenuOpen] = useState(false);

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
      'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium',
      isActive ? 'text-primary' : 'text-muted-foreground',
    );

  return (
    <div className="md:hidden">
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        {NAV_ITEMS.filter((item) => item.primary).map(({ path, label, icon: Icon }) => (
          <NavLink key={path} to={path} end={path === '/'} className={linkClass}>
            <Icon className="size-5" aria-hidden="true" />
            <span className="max-w-full truncate px-1">{label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="more-menu"
          onClick={() => setMenuOpen((open) => !open)}
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground"
        >
          {menuOpen ? (
            <X className="size-5" aria-hidden="true" />
          ) : (
            <Menu className="size-5" aria-hidden="true" />
          )}
          <span>More</span>
        </button>
      </nav>

      {menuOpen && (
        <div
          id="more-menu"
          role="dialog"
          aria-modal="true"
          aria-label="More navigation"
          className="fixed inset-x-0 bottom-14 z-20 border-t border-border bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-card"
        >
          <ul className="grid gap-1">
            {NAV_ITEMS.filter((item) => !item.primary).map(({ path, label, icon: Icon }) => (
              <li key={path}>
                <NavLink
                  to={path}
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium hover:bg-surface-muted"
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
