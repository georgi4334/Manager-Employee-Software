import { Outlet, useLocation } from 'react-router';
import { NotificationToast } from '@/features/notifications/NotificationToast';
import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-dvh bg-background text-foreground md:grid md:grid-cols-[16rem_1fr] md:bg-sidebar md:py-3">
      <Sidebar />
      <div className="flex min-h-dvh min-w-0 flex-col bg-background md:min-h-[calc(100dvh-1.5rem)] md:overflow-clip md:rounded-l-3xl">
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
