import { Logo } from '@/shared/ui/logo';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { ProfileDrawer } from './ProfileDrawer';

/** Only the notifications stay in the header; everything personal is in the profile drawer. */
export function Topbar() {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between bg-background/90 px-4 backdrop-blur md:px-6">
      <Logo className="text-lg md:hidden" markClassName="size-8" />
      <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
        <NotificationBell />
        <ProfileDrawer />
      </div>
    </header>
  );
}
