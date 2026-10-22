import { useTranslation } from 'react-i18next';
import { useApiStatusStore } from '@/shared/api/api-status.store';

/** Free-tier hosting puts the API to sleep; explain the wait instead of leaving a silent spinner. */
export function WakingUpBanner() {
  const { t } = useTranslation('common');
  const slow = useApiStatusStore((s) => s.slowRequests > 0);
  if (!slow) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-info px-4 py-2 text-center text-sm text-info-foreground"
    >
      {t('serverWaking')}
    </div>
  );
}
