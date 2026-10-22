import { NavLink } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { NAV_ITEMS } from '../nav';

export function Sidebar() {
  return (
    <aside className="hidden border-r border-border bg-surface md:flex md:flex-col">
      <div className="px-6 py-5 text-xl font-bold text-primary">InTime</div>
      <nav aria-label="Main navigation" className="flex flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) =>
              cn(
                'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
              )
            }
          >
            <Icon className="size-5" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
