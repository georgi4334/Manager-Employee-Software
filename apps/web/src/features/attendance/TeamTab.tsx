import { addDays } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/features/auth/permissions';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { useDuration } from './RecordRow';
import { usePresence, useRecords } from './hooks';
import { RecordForm } from './RecordForm';
import { RecordRow } from './RecordRow';
import { useAttendanceErrors } from './use-attendance-errors';
import { cn } from '@/shared/lib/cn';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATE_STYLE = {
  working: 'border border-success text-success',
  done: 'bg-secondary text-secondary-foreground',
  leave: 'border border-info text-info',
  none: 'border border-border text-muted-foreground',
} as const;

/** Who is in today, and the records of the people the caller may see (the server applies the scope). */
export function TeamTab({ today }: { today: string }) {
  const { t } = useTranslation('attendance');
  const errors = useAttendanceErrors();
  const duration = useDuration();
  const canCorrect = usePermission('attendance.correct');
  const presence = usePresence();
  const [from, setFrom] = useState(addDays(today, -7));
  const [to, setTo] = useState(today);
  const [adding, setAdding] = useState(false);
  const valid = DATE.test(from) && DATE.test(to) && from <= to;
  const list = useRecords({ from, to, page: 1, pageSize: 200 }, valid);
  const people = (presence.data?.items ?? []).map((item) => ({
    id: item.employee.id,
    name: `${item.employee.firstName} ${item.employee.lastName}`,
  }));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-base font-semibold">{t('team.today')}</h2>
        {presence.isError && <Alert tone="danger">{errors.apiError(presence.error)}</Alert>}
        {presence.data && presence.data.items.length === 0 && (
          <Card>
            <p className="text-center text-sm text-muted-foreground">{t('team.empty')}</p>
          </Card>
        )}
        {presence.data && presence.data.items.length > 0 && (
          <ul className="space-y-2" aria-label={t('team.today')}>
            {presence.data.items.map((item) => (
              <li
                key={item.employee.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-4 shadow-card"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {item.employee.firstName} {item.employee.lastName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {item.state === 'working' && item.since
                      ? t('team.since', {
                          start: item.since,
                          mode: item.mode ? t(`mode.${item.mode}`) : '',
                        })
                      : item.minutes > 0
                        ? duration(item.minutes)
                        : ''}
                  </p>
                </div>
                <span className={cn('rounded-full px-2 py-0.5 text-xs', STATE_STYLE[item.state])}>
                  {t(`state.${item.state}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-semibold">{t('team.records')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('history.from')}>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('history.to')}>
            {(field) => (
              <Input {...field} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            )}
          </Field>
        </div>
        {!valid && <p className="text-sm text-danger">{t('history.invalidRange')}</p>}
        {list.isError && <Alert tone="danger">{errors.apiError(list.error)}</Alert>}
        {list.data && list.data.items.length === 0 && (
          <Card>
            <p className="text-center text-sm text-muted-foreground">{t('history.empty')}</p>
          </Card>
        )}
        {list.data && list.data.items.length > 0 && (
          <ul className="space-y-2" aria-label={t('team.records')}>
            {list.data.items.map((record) => (
              <RecordRow key={record.id} record={record} showEmployee showDate />
            ))}
          </ul>
        )}
      </div>

      {canCorrect &&
        (adding ? (
          <Card className="space-y-3">
            <CardTitle>{t('team.addTitle')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('team.addHint')}</p>
            <RecordForm people={people} defaultDate={today} onDone={() => setAdding(false)} />
          </Card>
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            {t('team.addTitle')}
          </Button>
        ))}
    </div>
  );
}
