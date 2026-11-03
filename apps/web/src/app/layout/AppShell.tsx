import type { CSSProperties } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useSidebarStore } from '@/shared/stores/sidebar.store';
import { NotificationToast } from '@/features/notifications/NotificationToast';
import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell() {
  const { pathname } = useLocation();
  const collapsed = useSidebarStore((s) => s.collapsed);
  // The menu's width, also read by fixed bars that sit beside it (inbox bulk actions). Never animated (ADR 0032).
  const width = { '--sidebar-w': collapsed ? '4.75rem' : '16rem' } as CSSProperties;
  return (
    <div
      style={width}
      className="min-h-dvh bg-background text-foreground md:grid md:grid-cols-[var(--sidebar-w)_1fr] md:bg-sidebar md:py-3"
    >
      <Sidebar />
      <div className="glass-canvas flex min-h-dvh min-w-0 flex-col md:min-h-[calc(100dvh-1.5rem)] md:overflow-clip md:rounded-l-3xl">
        <Topbar />
        <main className="flex-1 p-4 pb-24 md:p-6 md:pb-6">
          {/* A new page glides in; the tabs and filters of one page (search params) do not replay it. */}
          <div key={pathname} className="motion-route">
            <Outlet />
          </div>
        </main>
      </div>
      <BottomNav />
      <NotificationToast />
    </div>
  );
}
