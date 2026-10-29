import { addDays, formatDuration, weekStartOf } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/features/auth/permissions';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { formatDay } from '@/shared/lib/format';
import { ComparePanel } from './ComparePanel';
import { EntryForm } from './EntryForm';
import { useSubmitWeek, useWeek } from './hooks';
import { StatusBadge } from './StatusBadge';
import { TimerCard } from './TimerCard';
import { useTimeErrors } from './use-time-errors';
import { WeekChart } from './WeekChart';
import { WeekDays } from './WeekDays';

export function WeekTab({ today }: { today: string }) {
  const { t, i18n } = useTranslation('time');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useTimeErrors();
  const canLog = usePermission('time.log');
  const seesAttendance = usePermission('attendance.view');
  const [weekStart, setWeekStart] = useState(weekStartOf(today));
  const [adding, setAdding] = useState(false);
  const week = useWeek(weekStart);
  const submit = useSubmitWeek();
  const data = week.data;
  const isCurrent = weekStart === weekStartOf(today);

  return (
    <div className="space-y-4">
      {canLog && <TimerCard />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          {t('week.previous')}
        </Button>
        <h2 className="text-base font-semibold" aria-live="polite">
          {t('week.of', { date: formatDay(weekStart, language) })}
        </h2>
        <Button variant="secondary" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          {t('week.next')}
        </Button>
        {!isCurrent && (
          <Button variant="ghost" onClick={() => setWeekStart(weekStartOf(today))}>
            {t('week.thisWeek')}
          </Button>
        )}
      </div>

      {week.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {week.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{errors.apiError(week.error)}</Alert>
          <Button onClick={() => void week.refetch()}>{t('retry')}</Button>
        </Card>
      )}
      {data && (
        <>
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                {t('week.total', { value: formatDuration(data.totalMinutes) })}
                {' · '}
                {t('week.billable', { value: formatDuration(data.billableMinutes) })}
              </p>
              <StatusBadge status={data.status} />
            </div>
            {submit.isError && <Alert tone="danger">{errors.apiError(submit.error)}</Alert>}
            <div className="flex flex-wrap gap-2">
              {canLog && data.status !== 'submitted' && data.status !== 'approved' && !adding && (
                <Button variant="secondary" onClick={() => setAdding(true)}>
                  {t('entry.add')}
                </Button>
              )}
              {data.canSubmit && (
                <Button disabled={submit.isPending} onClick={() => submit.mutate(weekStart)}>
                  {submit.isPending ? t('week.submitting') : t('week.submit')}
                </Button>
              )}
            </div>
            {data.status === 'submitted' && (
              <p className="text-sm text-muted-foreground">{t('week.lockedSubmitted')}</p>
            )}
            {data.status === 'approved' && (
              <p className="text-sm text-muted-foreground">{t('week.lockedApproved')}</p>
            )}
            {data.status === 'rejected' && <Alert tone="danger">{t('week.sentBack')}</Alert>}
          </Card>
          {adding && (
            <Card className="space-y-3">
              <h3 className="text-base font-semibold">{t('entry.addTitle')}</h3>
              <EntryForm
                defaultDate={isCurrent && today >= weekStart ? today : weekStart}
                onDone={() => setAdding(false)}
              />
            </Card>
          )}
          <WeekChart week={data} today={today} />
          {seesAttendance && <ComparePanel key={weekStart} weekStart={weekStart} />}
          <WeekDays week={data} />
        </>
      )}
    </div>
  );
}
