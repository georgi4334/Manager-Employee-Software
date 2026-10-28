import {
  PRESENCE_SORTS,
  addDays,
  attendanceDayLevel,
  attendanceTarget,
  groupAttendanceDays,
  sortAttendanceDays,
  sortPresence,
  type AttendanceSort,
  type PresenceItem,
  type PresenceSort,
} from '@intime/contracts';
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
import { DayCard } from './DayCard';
import { LevelPill, ProgressLine } from './DayProgress';
import { SortSelect } from './SortSelect';
import { useAttendanceErrors } from './use-attendance-errors';
import { cn } from '@/shared/lib/cn';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATE_STYLE = {
  working: 'border-primary/40 bg-accent text-accent-foreground',
  done: 'border-border bg-secondary text-secondary-foreground',
  leave: 'border-info/40 text-info',
  none: 'border-border text-muted-foreground',
} as const;
const TEAM_SORTS = ['newest', 'oldest', 'name', 'most', 'fewest', 'attention'] as const;

/** Who is in today, and the records of the people the caller may see (the server applies the scope). */
export function TeamTab({ today }: { today: string }) {
  const { t } = useTranslation('attendance');
  const errors = useAttendanceErrors();
  const canCorrect = usePermission('attendance.correct');
  const presence = usePresence();
  const [from, setFrom] = useState(addDays(today, -7));
  const [to, setTo] = useState(today);
  const [adding, setAdding] = useState(false);
  const [sort, setSort] = useState<AttendanceSort>('newest');
  const [presenceSort, setPresenceSort] = useState<PresenceSort>('status');
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
          <>
            <div className="flex justify-end">
              <SortSelect
                value={presenceSort}
                options={PRESENCE_SORTS}
                onChange={setPresenceSort}
              />
            </div>
            <ul className="grid gap-3 md:grid-cols-2" aria-label={t('team.today')}>
              {sortPresence(presence.data.items, presenceSort).map((item) => (
                <PresenceCard
                  key={item.employee.id}
                  item={item}
                  target={attendanceTarget(presence.data.date)}
                />
              ))}
            </ul>
          </>
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
          <>
            <div className="flex justify-end">
              <SortSelect value={sort} options={TEAM_SORTS} onChange={setSort} />
            </div>
            <ul className="space-y-3" aria-label={t('team.records')}>
              {sortAttendanceDays(groupAttendanceDays(list.data.items), sort).map((day) => (
                <DayCard key={day.key} day={day} showEmployee />
              ))}
            </ul>
          </>
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

/** One person today: state, since when or how long, and the 8-hour line while they work or are done. */
function PresenceCard({ item, target }: { item: PresenceItem; target: number }) {
  const { t } = useTranslation('attendance');
  const duration = useDuration();
  const { employee, state } = item;
  const recorded = state === 'working' || state === 'done';
  const level = attendanceDayLevel(item.minutes, { open: state === 'working', target });
  return (
    <li className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
        >
          {`${employee.firstName.charAt(0)}${employee.lastName.charAt(0)}`.toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {employee.firstName} {employee.lastName}
          </p>
          <p className="text-sm text-muted-foreground">
            {state === 'working' && item.since
              ? t('team.since', {
                  start: item.since,
                  mode: item.mode ? t(`mode.${item.mode}`) : '',
                })
              : item.minutes > 0
                ? duration(item.minutes)
                : ''}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
            STATE_STYLE[state],
          )}
        >
          {t(`state.${state}`)}
        </span>
      </div>
      {recorded && (
        <div className="flex items-center gap-2">
          <ProgressLine minutes={item.minutes} level={level} target={target} className="flex-1" />
          {state === 'done' && <LevelPill level={level} />}
        </div>
      )}
    </li>
  );
}
