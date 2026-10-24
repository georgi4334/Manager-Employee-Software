import { addDays } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui/alert';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { useLeaveRequests } from './hooks';
import { RequestRow } from './RequestRow';
import { useLeaveErrors } from './use-leave-errors';

/** Who is off in a period, for the people the caller may see (the server applies the scope). */
export function TeamTab({ today }: { today: string }) {
  const { t } = useTranslation('leave');
  const errors = useLeaveErrors();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 30));
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const list = useLeaveRequests({ from, to, page: 1, pageSize: 100 }, valid);
  // Rejected and cancelled requests are not absences.
  const absences = (list.data?.items ?? []).filter(
    (r) => r.status === 'approved' || r.status === 'pending',
  );

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">{t('team.title')}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('team.from')}>
          {(field) => (
            <Input {...field} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          )}
        </Field>
        <Field label={t('team.to')}>
          {(field) => (
            <Input {...field} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          )}
        </Field>
      </div>
      {list.isError && <Alert tone="danger">{errors.apiError(list.error)}</Alert>}
      {valid && list.data && absences.length === 0 && (
        <Card>
          <p className="text-center text-sm text-muted-foreground">{t('team.empty')}</p>
        </Card>
      )}
      {absences.length > 0 && (
        <ul className="space-y-2" aria-label={t('team.title')}>
          {absences.map((request) => (
            <RequestRow key={request.id} request={request} showEmployee cancel />
          ))}
        </ul>
      )}
    </div>
  );
}
