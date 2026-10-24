import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { useLeaveRequests } from './hooks';
import { RequestRow } from './RequestRow';
import { useLeaveErrors } from './use-leave-errors';

/** Pending requests the signed-in person may decide (never their own: the server never lists them). */
export function ApprovalsTab() {
  const { t } = useTranslation(['leave', 'common']);
  const errors = useLeaveErrors();
  const list = useLeaveRequests({ approvable: true, page: 1, pageSize: 100 });

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">{t('approvals.title')}</h2>
      {list.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {list.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{errors.apiError(list.error)}</Alert>
          <Button onClick={() => void list.refetch()}>{t('common:retry')}</Button>
        </Card>
      )}
      {list.data && list.data.items.length === 0 && (
        <Card>
          <p className="text-center text-sm text-muted-foreground">{t('approvals.empty')}</p>
        </Card>
      )}
      {list.data && list.data.items.length > 0 && (
        <ul className="space-y-2" aria-label={t('approvals.title')}>
          {list.data.items.map((request) => (
            <RequestRow key={request.id} request={request} showEmployee decide cancel />
          ))}
        </ul>
      )}
    </div>
  );
}
