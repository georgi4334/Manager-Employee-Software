import { useTranslation } from 'react-i18next';
import { usePermission } from '@/features/auth/permissions';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { useDownloadOwnData } from './hooks';
import { usePrivacyErrors } from './use-privacy-errors';

/** "Download my data" (GDPR Art. 15/20), on the own profile. */
export function OwnDataCard() {
  const { t } = useTranslation('privacy');
  const errors = usePrivacyErrors();
  const allowed = usePermission('gdpr.export_own');
  const download = useDownloadOwnData();
  if (!allowed) return null;

  return (
    <Card className="space-y-3">
      <CardTitle>{t('own.title')}</CardTitle>
      <p className="text-sm text-muted-foreground">{t('own.text')}</p>
      {download.isError && <Alert tone="danger">{errors.apiError(download.error)}</Alert>}
      {download.isSuccess && <Alert tone="success">{t('own.done')}</Alert>}
      <Button variant="secondary" disabled={download.isPending} onClick={() => download.mutate()}>
        {download.isPending ? t('working') : t('own.download')}
      </Button>
    </Card>
  );
}
