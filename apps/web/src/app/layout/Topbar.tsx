import { useTranslation } from 'react-i18next';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { ProfileDrawer } from './ProfileDrawer';

/** Only the notifications stay in the header; everything personal is in the profile drawer. */
export function Topbar() {
  const { t } = useTranslation('common');
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between bg-background/90 px-4 backdrop-blur md:px-6">
      <span className="text-lg font-bold text-primary md:hidden">{t('appName')}</span>
      <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
        <NotificationBell />
        <ProfileDrawer />
      </div>
    </header>
  );
}
