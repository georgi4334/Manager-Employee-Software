import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import type { OneOnOnePeople } from '@intime/contracts';
import {
  emptySchedule,
  scheduleFormSchema,
  toCreateMeeting,
  type ScheduleFormValues,
} from './forms';
import { useCreateMeeting } from './hooks';
import { useMeetingErrors } from './use-meeting-errors';

export function ScheduleForm({
  people,
  onDone,
}: {
  people: OneOnOnePeople['items'];
  onDone: (id?: string) => void;
}) {
  const { t } = useTranslation('meetings');
  const messages = useMessages();
  const errors = useMeetingErrors();
  const create = useCreateMeeting();
  const form = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: {
      ...emptySchedule(),
      employeeId: people[0]?.relation === 'report' ? people[0].id : '',
    },
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      aria-label={t('form.title')}
      onSubmit={form.handleSubmit((v) =>
        create.mutate(toCreateMeeting(v), { onSuccess: (created) => onDone(created.id) }),
      )}
    >
      <div className="sm:col-span-2">
        <Field label={t('form.with')}>
          {(field) => (
            <Select {...field} {...form.register('employeeId')}>
              {people.map((p) => (
                <option key={p.id} value={p.relation === 'manager' ? '' : p.id}>
                  {p.relation === 'manager'
                    ? t('form.myManager', { name: `${p.firstName} ${p.lastName}` })
                    : `${p.firstName} ${p.lastName}`}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label={t('form.date')} error={messages.validation(e.date)}>
        {(field) => <Input {...field} type="date" {...form.register('date')} />}
      </Field>
      <Field label={t('form.time')} error={messages.validation(e.time)}>
        {(field) => <Input {...field} type="time" {...form.register('time')} />}
      </Field>
      <Field label={t('form.minutes')} error={messages.validation(e.durationMinutes)}>
        {(field) => <Input {...field} inputMode="numeric" {...form.register('durationMinutes')} />}
      </Field>
      <div className="sm:col-span-2">
        <Field label={t('form.agenda')} error={messages.validation(e.agenda)}>
          {(field) => (
            <Input {...field} maxLength={1000} autoComplete="off" {...form.register('agenda')} />
          )}
        </Field>
      </div>
      {create.isError && (
        <div className="sm:col-span-2">
          <Alert tone="danger">{errors.apiError(create.error)}</Alert>
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={create.isPending}>
          {t('form.schedule')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone()}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}
