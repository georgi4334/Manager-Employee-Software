import { Logo } from '@/shared/ui/logo';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { ProfileDrawer } from './ProfileDrawer';

/** The header keeps search, notifications and the profile drawer (everything personal is in the drawer). */
export function Topbar() {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between bg-background/90 px-4 backdrop-blur-xl md:px-6">
      <Logo className="text-lg md:hidden" markClassName="size-8" />
      <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
        <CommandPalette />
        <NotificationBell />
        <ProfileDrawer />
      </div>
    </header>
  );
}
