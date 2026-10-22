import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/shared/ui/button';

export function NotFoundPage() {
  const { t } = useTranslation(['common', 'errors']);
  return (
    <div className="mx-auto max-w-md space-y-4 py-12 text-center">
      <h1 className="text-2xl font-semibold">{t('errors:notFoundTitle')}</h1>
      <p className="text-sm text-muted-foreground">{t('errors:notFoundText')}</p>
      <Button asChild>
        <Link to="/">{t('common:backToDashboard')}</Link>
      </Button>
    </div>
  );
}
