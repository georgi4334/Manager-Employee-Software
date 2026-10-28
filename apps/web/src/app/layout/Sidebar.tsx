import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { Logo } from '@/shared/ui/logo';
import { useNavItems } from '../useNavItems';

export function Sidebar() {
  const { t } = useTranslation(['common', 'nav']);
  const items = useNavItems();
  return (
    <aside className="hidden bg-sidebar text-sidebar-foreground scrollbar-subtle md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:overflow-y-auto">
      <Logo className="gap-3 px-6 pb-9 pt-10 text-xl" />
      <p className="px-6 pb-2 text-xs font-semibold uppercase tracking-wider text-sidebar-muted">
        {t('nav:menu')}
      </p>
      <nav aria-label={t('common:mainNavigation')} className="flex flex-col gap-1 px-3 pb-12">
        {items.map(({ path, labelKey, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) =>
              cn(
                'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-[background-color,color,transform] duration-300 ease-[var(--ease-standard)] active:scale-[0.98]',
                isActive
                  ? 'nav-active text-sidebar-foreground'
                  : 'text-sidebar-muted hover:bg-sidebar-border/60 hover:text-sidebar-foreground',
              )
            }
          >
            <Icon className="size-5" aria-hidden="true" />
            {t(`nav:${labelKey}`)}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
