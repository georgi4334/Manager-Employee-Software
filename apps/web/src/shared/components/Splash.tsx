import { useTranslation } from 'react-i18next';
import { LogoMark } from '@/shared/ui/logo';

/** Shown while the app asks who is signed in; looks like the static copy in index.html. */
export function Splash() {
  const { t } = useTranslation('common');
  return (
    <div className="splash" role="status">
      <LogoMark className="splash-mark size-16" />
      <span className="splash-name" aria-hidden="true">
        {t('appName')}
      </span>
      <span className="splash-bar" aria-hidden="true" />
      <span className="sr-only">{t('loading')}</span>
    </div>
  );
}
