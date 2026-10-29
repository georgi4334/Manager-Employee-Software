import { formatDuration, type Timesheet } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Select } from '@/shared/ui/select';
import { formatDay } from '@/shared/lib/format';
import { useDecideTimesheet, useTimesheetDetail, useTimesheets } from './hooks';
import { ComparePanel } from './ComparePanel';
import { StatusBadge } from './StatusBadge';
import { useTimeErrors } from './use-time-errors';
import { WeekDays } from './WeekDays';

type Filter = 'submitted' | 'approved' | 'rejected' | 'all';

export function ApprovalsTab() {
  const { t } = useTranslation('time');
  const errors = useTimeErrors();
  const [status, setStatus] = useState<Filter>('submitted');
  const query = useTimesheets(status);
  const data = query.data;

  return (
    <div className="space-y-4">
      <Select
        className="sm:w-56"
        aria-label={t('approvals.filter')}
        value={status}
        onChange={(e) => setStatus(e.target.value as Filter)}
      >
        {(['submitted', 'approved', 'rejected', 'all'] as const).map((s) => (
          <option key={s} value={s}>
            {t(`approvals.filters.${s}`)}
          </option>
        ))}
      </Select>
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {query.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{errors.apiError(query.error)}</Alert>
          <Button onClick={() => void query.refetch()}>{t('retry')}</Button>
        </Card>
      )}
      {data &&
        (data.items.length === 0 ? (
          <Card>
            <p className="text-center text-sm text-muted-foreground">{t('approvals.empty')}</p>
          </Card>
        ) : (
          <ul className="space-y-2" aria-label={t('tabs.approvals')}>
            {data.items.map((sheet) => (
              <SheetRow key={sheet.id} sheet={sheet} />
            ))}
          </ul>
        ))}
    </div>
  );
}

function SheetRow({ sheet }: { sheet: Timesheet }) {
  const { t, i18n } = useTranslation('time');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useTimeErrors();
  const [open, setOpen] = useState(false);
  const detail = useTimesheetDetail(sheet.id, open);
  const decide = useDecideTimesheet();
  const name = `${sheet.employee.firstName} ${sheet.employee.lastName}`;

  return (
    <li className="space-y-3 rounded-xl glass p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{name}</p>
          <p className="text-sm text-muted-foreground">
            {t('week.of', { date: formatDay(sheet.weekStart, language) })}
            {' · '}
            {t('hours', { value: formatDuration(sheet.totalMinutes) })}
          </p>
        </div>
        <StatusBadge status={sheet.status} />
      </div>
      {decide.isError && <Alert tone="danger">{errors.apiError(decide.error)}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          aria-expanded={open}
          aria-label={t(open ? 'approvals.hideFor' : 'approvals.showFor', { name })}
          onClick={() => setOpen(!open)}
        >
          {t(open ? 'approvals.hide' : 'approvals.show')}
        </Button>
        {sheet.canDecide && (
          <>
            <Button
              disabled={decide.isPending}
              aria-label={t('approvals.approveFor', { name })}
              onClick={() => decide.mutate({ id: sheet.id, action: 'approve' })}
            >
              {t('approvals.approve')}
            </Button>
            <Button
              variant="secondary"
              disabled={decide.isPending}
              aria-label={t('approvals.rejectFor', { name })}
              onClick={() => decide.mutate({ id: sheet.id, action: 'reject' })}
            >
              {t('approvals.reject')}
            </Button>
          </>
        )}
        {sheet.canReopen && (
          <Button
            variant="ghost"
            disabled={decide.isPending}
            aria-label={t('approvals.reopenFor', { name })}
            onClick={() => decide.mutate({ id: sheet.id, action: 'reopen' })}
          >
            {t('approvals.reopen')}
          </Button>
        )}
      </div>
      {open && detail.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {open && detail.isError && <Alert tone="danger">{errors.apiError(detail.error)}</Alert>}
      {open && detail.data && (
        <>
          <ComparePanel weekStart={sheet.weekStart} employeeId={sheet.employee.id} openByDefault />
          <WeekDays week={detail.data} />
        </>
      )}
    </li>
  );
}
