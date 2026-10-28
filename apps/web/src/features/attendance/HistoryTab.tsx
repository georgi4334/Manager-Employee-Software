import {
  addDays,
  groupAttendanceDays,
  sortAttendanceDays,
  type AttendanceSort,
} from '@intime/contracts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOwnEmployee } from '@/features/employees/hooks';
import { Alert } from '@/shared/ui/alert';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { useRecords } from './hooks';
import { DayCard } from './DayCard';
import { LevelSummary } from './DayProgress';
import { useDuration } from './RecordRow';
import { SortSelect } from './SortSelect';
import { useAttendanceErrors } from './use-attendance-errors';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_SORTS = ['newest', 'oldest', 'most', 'fewest', 'attention'] as const;

/** Your own records over a period. */
export function HistoryTab({ today }: { today: string }) {
  const { t } = useTranslation('attendance');
  const errors = useAttendanceErrors();
  const duration = useDuration();
  const own = useOwnEmployee();
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const valid = DATE.test(from) && DATE.test(to) && from <= to;
  const list = useRecords(
    { employeeId: own.data?.id, from, to, page: 1, pageSize: 200 },
    valid && Boolean(own.data),
  );
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = items.reduce((sum, r) => sum + (r.minutes ?? 0), 0);
  const [sort, setSort] = useState<AttendanceSort>('newest');
  const days = useMemo(() => groupAttendanceDays(items), [items]);
  const sorted = useMemo(() => sortAttendanceDays(days, sort), [days, sort]);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('history.from')}>
          {(field) => (
            <Input {...field} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          )}
        </Field>
        <Field label={t('history.to')}>
          {(field) => (
            <Input {...field} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          )}
        </Field>
      </div>
      {!valid && <p className="text-sm text-danger">{t('history.invalidRange')}</p>}
      {own.isError && <Alert tone="info">{t('noRecord')}</Alert>}
      {list.isError && <Alert tone="danger">{errors.apiError(list.error)}</Alert>}
      {list.data && items.length === 0 && (
        <Card>
          <p className="text-center text-sm text-muted-foreground">{t('history.empty')}</p>
        </Card>
      )}
      {items.length > 0 && (
        <>
          <Card className="space-y-3">
            <p className="text-lg font-semibold">
              {t('history.total', { duration: duration(total) })}
            </p>
            <LevelSummary days={days} />
          </Card>
          <div className="flex justify-end">
            <SortSelect value={sort} options={HISTORY_SORTS} onChange={setSort} />
          </div>
          <ul className="space-y-3" aria-label={t('history.list')}>
            {sorted.map((day) => (
              <DayCard key={day.key} day={day} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
