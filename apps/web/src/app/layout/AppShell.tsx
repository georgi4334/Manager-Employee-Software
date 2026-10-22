import { Outlet } from 'react-router';
import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell() {
  return (
    <div className="min-h-dvh bg-background text-foreground md:grid md:grid-cols-[16rem_1fr]">
      <Sidebar />
      <div className="flex min-h-dvh min-w-0 flex-col">
        <Topbar />
        <main className="flex-1 p-4 pb-24 md:p-6 md:pb-6">
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
