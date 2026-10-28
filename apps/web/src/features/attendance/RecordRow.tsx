import type { AttendanceRecord } from '@intime/contracts';
import { Building2, House, MapPin } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { formatDay, formatNumber } from '@/shared/lib/format';
import { splitMinutes } from './format';
import { useDeleteRecord } from './hooks';
import { RecordForm } from './RecordForm';
import { useAttendanceErrors } from './use-attendance-errors';

interface RecordRowProps {
  record: AttendanceRecord;
  /** Show who the record belongs to (lists of other people). */
  showEmployee?: boolean;
  /** Show the date (lists over several days). */
  showDate?: boolean;
}

export function useDuration() {
  const { t, i18n } = useTranslation('attendance');
  const language = i18n.resolvedLanguage ?? 'en';
  return (minutes: number): string => {
    const parts = splitMinutes(minutes);
    return t('duration', {
      hours: formatNumber(parts.hours, language),
      minutes: formatNumber(parts.minutes, language),
    });
  };
}

const MODE_ICON = { office: Building2, remote: House, field: MapPin } as const;

/** One attendance record inside a day card, with the actions the server says the caller may take. */
export function RecordRow({ record, showEmployee, showDate }: RecordRowProps) {
  const { t, i18n } = useTranslation('attendance');
  const language = i18n.resolvedLanguage ?? 'en';
  const duration = useDuration();
  const errors = useAttendanceErrors();
  const remove = useDeleteRecord();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const name = `${record.employee.firstName} ${record.employee.lastName}`;
  const ModeIcon = MODE_ICON[record.mode];

  if (editing) {
    return (
      <li className="py-3">
        <RecordForm record={record} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"
        >
          <ModeIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          {showEmployee && <p className="font-medium">{name}</p>}
          <p className="font-medium tabular-nums">
            {showDate && `${formatDay(record.date, language)} · `}
            {record.open
              ? t('record.since', { start: record.startTime })
              : t('record.range', { start: record.startTime, end: record.endTime })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(`mode.${record.mode}`)}
            {record.minutes !== null && ` · ${duration(record.minutes)}`}
            {record.source === 'correction' && ` · ${t('record.corrected')}`}
          </p>
          {record.note && <p className="break-words text-sm">{record.note}</p>}
        </div>
        {record.open && (
          <span className="rounded-full border border-primary/40 bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
            {t('record.open')}
          </span>
        )}
        {record.canEdit && !confirming && (
          <div className="flex gap-1">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t('record.edit')}
            </Button>
            {!record.open && (
              <Button variant="ghost" onClick={() => setConfirming(true)}>
                {t('record.delete')}
              </Button>
            )}
          </div>
        )}
      </div>
      {remove.isError && <Alert tone="danger">{errors.apiError(remove.error)}</Alert>}
      {confirming && (
        <div className="space-y-2" role="group" aria-label={t('record.confirmDelete')}>
          <p className="text-sm">{t('record.confirmDelete')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(record.id, {
                  onSuccess: () => setConfirming(false),
                })
              }
            >
              {t('record.deleteConfirm')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('record.cancel')}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
