import { useTranslation } from 'react-i18next';
import type { NavItem } from '@/app/nav';
import { Card } from '@/shared/ui/card';

export function ModulePlaceholderPage({ labelKey }: { labelKey: NavItem['labelKey'] }) {
  const { t } = useTranslation(['common', 'nav']);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t(`nav:${labelKey}`)}</h1>
      <Card>
        <p className="text-sm text-muted-foreground">{t('common:comingSoon')}</p>
      </Card>
    </div>
  );
}
