import { useTranslation } from 'react-i18next';
import { Card, CardTitle } from '@/shared/ui/card';

export function DashboardPage() {
  const { t } = useTranslation('dashboard');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardTitle>{t('welcomeTitle')}</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">{t('welcomeText')}</p>
        </Card>
      </div>
    </div>
  );
}
