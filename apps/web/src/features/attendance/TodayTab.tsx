import { ATTENDANCE_MODES, type AttendanceMode } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/shared/api/api-error';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { formatDay } from '@/shared/lib/format';
import { useAttendanceStatus, useCheckIn, useCheckOut } from './hooks';
import { RecordForm } from './RecordForm';
import { RecordRow, useDuration } from './RecordRow';
import { useAttendanceErrors } from './use-attendance-errors';

/** Check in and out, today's records and typing in a forgotten period. */
export function TodayTab() {
  const { t, i18n } = useTranslation('attendance');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useAttendanceErrors();
  const duration = useDuration();
  const status = useAttendanceStatus();
  const [adding, setAdding] = useState(false);

  if (status.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  }
  if (status.isError) {
    return isApiError(status.error, 'NOT_FOUND') ? (
      <Alert tone="info">{t('noRecord')}</Alert>
    ) : (
      <Alert tone="danger">{errors.apiError(status.error)}</Alert>
    );
  }

  const { today, open, records, minutes } = status.data;
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <CardTitle>{formatDay(today, language, { dateStyle: 'full' })}</CardTitle>
        {open ? <ClockOut since={open.startTime} mode={open.mode} /> : <ClockIn />}
        <p className="text-sm text-muted-foreground">
          {t('today.total', { duration: duration(minutes) })}
        </p>
      </Card>

      <div className="space-y-2">
        <h2 className="text-base font-semibold">{t('today.records')}</h2>
        {records.length === 0 ? (
          <Card>
            <p className="text-center text-sm text-muted-foreground">{t('today.empty')}</p>
          </Card>
        ) : (
          <ul className="space-y-2" aria-label={t('today.records')}>
            {records.map((record) => (
              <RecordRow key={record.id} record={record} />
            ))}
          </ul>
        )}
      </div>

      {adding ? (
        <Card className="space-y-3">
          <CardTitle>{t('form.addTitle')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('form.addHint')}</p>
          <RecordForm defaultDate={today} onDone={() => setAdding(false)} />
        </Card>
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          {t('form.addTitle')}
        </Button>
      )}
    </div>
  );
}

function ClockIn() {
  const { t } = useTranslation('attendance');
  const errors = useAttendanceErrors();
  const checkIn = useCheckIn();
  const [mode, setMode] = useState<AttendanceMode>('office');
  const [note, setNote] = useState('');
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('clock.notIn')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('form.mode')}>
          {(field) => (
            <Select
              {...field}
              value={mode}
              onChange={(e) => setMode(e.target.value as AttendanceMode)}
            >
              {ATTENDANCE_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`mode.${m}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('form.note')}>
          {(field) => (
            <Input
              {...field}
              value={note}
              maxLength={200}
              autoComplete="off"
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </div>
      {checkIn.isError && <Alert tone="danger">{errors.apiError(checkIn.error)}</Alert>}
      <Button
        className="w-full sm:w-auto"
        disabled={checkIn.isPending}
        onClick={() =>
          checkIn.mutate(
            { mode, ...(note.trim() ? { note: note.trim() } : {}) },
            { onSuccess: () => setNote('') },
          )
        }
      >
        {t('clock.checkIn')}
      </Button>
    </div>
  );
}

function ClockOut({ since, mode }: { since: string; mode: AttendanceMode }) {
  const { t } = useTranslation('attendance');
  const errors = useAttendanceErrors();
  const checkOut = useCheckOut();
  return (
    <div className="space-y-3">
      <p className="font-medium">{t('clock.working', { start: since, mode: t(`mode.${mode}`) })}</p>
      {checkOut.isError && <Alert tone="danger">{errors.apiError(checkOut.error)}</Alert>}
      <Button
        className="w-full sm:w-auto"
        disabled={checkOut.isPending}
        onClick={() => checkOut.mutate({})}
      >
        {t('clock.checkOut')}
      </Button>
    </div>
  );
}
