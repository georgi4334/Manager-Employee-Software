import type { Employee } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/features/auth/permissions';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { useDownloadEmployeeData, useEraseEmployee } from './hooks';
import { usePrivacyErrors } from './use-privacy-errors';

/** Data export for subject access requests, and erasure of former employees. Hidden without the permissions. */
export function EmployeeDataPanel({ employee }: { employee: Employee }) {
  const { t } = useTranslation('privacy');
  const errors = usePrivacyErrors();
  const canExport = usePermission('gdpr.export_employee');
  const canErase = usePermission('gdpr.erase_employee');
  const download = useDownloadEmployeeData(employee.id);
  const [confirming, setConfirming] = useState(false);
  const showErase =
    canErase && employee.status === 'inactive' && !employee.isSelf && !employee.erased;
  if (!canExport && !showErase) return null;

  const name = `${employee.firstName} ${employee.lastName}`;
  return (
    <Card className="space-y-3">
      <CardTitle>{t('employee.title')}</CardTitle>
      <p className="text-sm text-muted-foreground">{t('employee.text')}</p>
      {download.isError && <Alert tone="danger">{errors.apiError(download.error)}</Alert>}
      {download.isSuccess && <Alert tone="success">{t('employee.downloaded')}</Alert>}
      <div className="flex flex-wrap gap-2">
        {canExport && (
          <Button
            variant="secondary"
            disabled={download.isPending}
            onClick={() => download.mutate()}
          >
            {download.isPending ? t('working') : t('employee.download')}
          </Button>
        )}
        {showErase && !confirming && (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {t('erase.open')}
          </Button>
        )}
      </div>
      {showErase && confirming && (
        <ErasePanel employeeId={employee.id} name={name} onClose={() => setConfirming(false)} />
      )}
    </Card>
  );
}

function ErasePanel({
  employeeId,
  name,
  onClose,
}: {
  employeeId: string;
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('privacy');
  const errors = usePrivacyErrors();
  const erase = useEraseEmployee(employeeId);
  const [understood, setUnderstood] = useState(false);

  return (
    <div
      className="space-y-3 rounded-lg border border-danger p-3"
      role="group"
      aria-label={t('erase.title', { name })}
    >
      <p className="font-medium">{t('erase.title', { name })}</p>
      <p className="text-sm">{t('erase.warning')}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>{t('erase.removes')}</li>
        <li>{t('erase.keeps')}</li>
      </ul>
      <label className="flex min-h-11 items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-5"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
        />
        {t('erase.understand')}
      </label>
      {erase.isError && <Alert tone="danger">{errors.apiError(erase.error)}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="danger"
          disabled={!understood || erase.isPending}
          onClick={() => erase.mutate(undefined, { onSuccess: onClose })}
        >
          {erase.isPending ? t('working') : t('erase.confirm')}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t('erase.cancel')}
        </Button>
      </div>
    </div>
  );
}
