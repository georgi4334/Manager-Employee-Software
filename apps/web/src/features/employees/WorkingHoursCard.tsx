import { zodResolver } from '@hookform/resolvers/zod';
import { formatDuration, weekMinutes, type Employee, type WorkSchedules } from '@intime/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { useCurrentUser } from '@/features/auth/use-auth';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { formatDay } from '@/shared/lib/format';
import { todayIn } from '@intime/contracts';
import { useEmployeeErrors } from './use-employee-messages';
import { useRemoveSchedule, useSchedule, useSetSchedule } from './schedule';
import {
  scheduleFormSchema,
  scheduleFormValues,
  toScheduleRequest,
  type ScheduleFormValues,
} from './schedule-form';

/** 2026-10-26 is a Monday: the seven dates give the weekday names in the user's language. */
const REFERENCE_MONDAY = '2026-10-26';
const referenceDay = (index: number) =>
  new Date(Date.parse(`${REFERENCE_MONDAY}T00:00:00Z`) + index * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** Working hours of a person (ADR 0026). Shown to whoever sees the full profile; editable with the permission. */
export function WorkingHoursCard({ employee }: { employee: Employee }) {
  const { t, i18n } = useTranslation('employees');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useEmployeeErrors();
  const visible = employee.profile !== null && !employee.erased;
  const query = useSchedule(employee.id, visible);
  const remove = useRemoveSchedule(employee.id);
  const [editing, setEditing] = useState(false);
  if (!visible) return null;
  const weekday = (index: number) => formatDay(referenceDay(index), language, { weekday: 'long' });
  const hours = (minutes: number) => t('schedule.hours', { value: formatDuration(minutes) });

  return (
    <Card className="space-y-3" aria-labelledby="working-hours-title">
      <CardTitle id="working-hours-title">{t('schedule.title')}</CardTitle>
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('schedule.loading')}
        </p>
      )}
      {query.isError && <Alert tone="danger">{errors.apiError(query.error)}</Alert>}
      {query.data && (
        <>
          <p className="text-sm text-muted-foreground">
            {query.data.isDefault ? t('schedule.default') : t('schedule.set')}
          </p>
          <ul aria-label={t('schedule.week')} className="grid gap-1 text-sm sm:grid-cols-2">
            {query.data.effective.map((minutes, index) => (
              <li key={index} className="flex justify-between gap-3">
                <span>{weekday(index)}</span>
                <span className={minutes === 0 ? 'text-muted-foreground' : 'font-medium'}>
                  {minutes === 0 ? t('schedule.dayOff') : hours(minutes)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm font-medium">
            {t('schedule.total', { value: formatDuration(weekMinutes(query.data.effective)) })}
          </p>

          {query.data.items.length > 0 && (
            <section aria-labelledby="schedule-changes" className="space-y-2">
              <h3 id="schedule-changes" className="text-sm font-semibold">
                {t('schedule.changes')}
              </h3>
              <ul className="space-y-2">
                {query.data.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      {t('schedule.from', { date: formatDay(item.validFrom, language) })}
                      {' · '}
                      {t('schedule.perWeek', { value: formatDuration(weekMinutes(item.minutes)) })}
                      {item.current && (
                        <span className="ml-2 rounded-full border border-primary px-2 py-0.5 text-xs text-primary">
                          {t('schedule.inForce')}
                        </span>
                      )}
                    </span>
                    {query.data.canManage && (
                      <Button
                        variant="ghost"
                        disabled={remove.isPending}
                        aria-label={t('schedule.remove', {
                          date: formatDay(item.validFrom, language),
                        })}
                        onClick={() => remove.mutate(item.id)}
                      >
                        {t('schedule.removeShort')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {remove.isError && <Alert tone="danger">{errors.apiError(remove.error)}</Alert>}

          {query.data.canManage && (
            <>
              {!editing && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  {t('schedule.change')}
                </Button>
              )}
              {editing && (
                <ScheduleForm
                  employee={employee}
                  state={query.data}
                  weekday={weekday}
                  onDone={() => setEditing(false)}
                />
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}

function ScheduleForm({
  employee,
  state,
  weekday,
  onDone,
}: {
  employee: Employee;
  state: WorkSchedules;
  weekday: (index: number) => string;
  onDone: () => void;
}) {
  const { t } = useTranslation('employees');
  const errors = useEmployeeErrors();
  const messages = useMessages();
  const { data: user } = useCurrentUser();
  const today = todayIn(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const save = useSetSchedule(employee.id);
  const form = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: scheduleFormValues(today, state.effective),
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="space-y-3"
      aria-label={t('schedule.form')}
      onSubmit={form.handleSubmit((v) => save.mutate(toScheduleRequest(v), { onSuccess: onDone }))}
    >
      <Field
        label={t('schedule.validFrom')}
        error={messages.validation(e.validFrom)}
        hint={t('schedule.validFromHint')}
      >
        {(field) => <Input {...field} type="date" {...form.register('validFrom')} />}
      </Field>
      <p className="text-xs text-muted-foreground">{t('schedule.hint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 7 }, (_, index) => (
          <Field key={index} label={weekday(index)} error={messages.validation(e.days?.[index])}>
            {(field) => (
              <Input
                {...field}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                {...form.register(`days.${index}`)}
              />
            )}
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>
          {t('schedule.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('schedule.cancel')}
        </Button>
      </div>
      {save.isError && <Alert tone="danger">{errors.apiError(save.error)}</Alert>}
    </form>
  );
}
