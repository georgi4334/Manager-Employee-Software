import { zodResolver } from '@hookform/resolvers/zod';
import { ATTENDANCE_MODES, type AttendanceRecord } from '@intime/contracts';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import {
  openRecordFormSchema,
  recordFormSchema,
  toCreateRequest,
  toOpenUpdate,
  toUpdateRequest,
  valuesOf,
  type OpenRecordFormValues,
  type RecordFormValues,
} from './forms';
import { useCreateRecord, useUpdateRecord } from './hooks';
import { useAttendanceErrors } from './use-attendance-errors';

export interface PersonOption {
  id: string;
  name: string;
}

interface RecordFormProps {
  /** Editing this record; creating one when omitted. */
  record?: AttendanceRecord;
  /** Correctors may pick whose record to add. */
  people?: PersonOption[];
  defaultDate?: string;
  onDone: () => void;
}

/** Add or change a record: times are typed in the workspace time zone. */
export function RecordForm({ record, ...props }: RecordFormProps) {
  return record?.open ? (
    <OpenRecordForm record={record} onDone={props.onDone} />
  ) : (
    <TimesForm record={record} {...props} />
  );
}

function TimesForm({ record, people, defaultDate = '', onDone }: RecordFormProps) {
  const { t } = useTranslation('attendance');
  const messages = useMessages();
  const errors = useAttendanceErrors();
  const create = useCreateRecord();
  const update = useUpdateRecord(record?.id ?? '');
  const mutation = record ? update : create;
  const form = useForm<RecordFormValues>({
    resolver: zodResolver(recordFormSchema),
    defaultValues: record
      ? valuesOf(record)
      : {
          employeeId: '',
          date: defaultDate,
          startTime: '',
          endTime: '',
          mode: 'office',
          note: '',
        },
  });
  const fieldErrors = form.formState.errors;

  const submit = (v: RecordFormValues) => {
    const done = { onSuccess: onDone };
    if (record) update.mutate(toUpdateRequest(v), done);
    else create.mutate(toCreateRequest(v), done);
  };

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={form.handleSubmit(submit)}
      aria-label={record ? t('form.editTitle') : t('form.addTitle')}
    >
      {people && !record && (
        <div className="sm:col-span-2">
          <Field label={t('form.person')}>
            {(field) => (
              <Select {...field} {...form.register('employeeId')}>
                <option value="">{t('form.myself')}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}
      <div className="sm:col-span-2">
        <Field label={t('form.date')} error={messages.validation(fieldErrors.date)}>
          {(field) => <Input {...field} type="date" {...form.register('date')} />}
        </Field>
      </div>
      <Field label={t('form.start')} error={messages.validation(fieldErrors.startTime)}>
        {(field) => <Input {...field} type="time" {...form.register('startTime')} />}
      </Field>
      <Field label={t('form.end')} error={messages.validation(fieldErrors.endTime)}>
        {(field) => <Input {...field} type="time" {...form.register('endTime')} />}
      </Field>
      <Field label={t('form.mode')}>
        {(field) => (
          <Select {...field} {...form.register('mode')}>
            {ATTENDANCE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`mode.${mode}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('form.note')} error={messages.validation(fieldErrors.note)}>
        {(field) => (
          <Input {...field} maxLength={200} autoComplete="off" {...form.register('note')} />
        )}
      </Field>
      {mutation.isError && (
        <div className="sm:col-span-2">
          <Alert tone="danger">{errors.apiError(mutation.error)}</Alert>
        </div>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t('form.saving') : t('form.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}

function OpenRecordForm({ record, onDone }: { record: AttendanceRecord; onDone: () => void }) {
  const { t } = useTranslation('attendance');
  const messages = useMessages();
  const errors = useAttendanceErrors();
  const update = useUpdateRecord(record.id);
  const form = useForm<OpenRecordFormValues>({
    resolver: zodResolver(openRecordFormSchema),
    defaultValues: { mode: record.mode, note: record.note ?? '' },
  });

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      aria-label={t('form.editTitle')}
      onSubmit={form.handleSubmit((v) => update.mutate(toOpenUpdate(v), { onSuccess: onDone }))}
    >
      <p className="text-sm text-muted-foreground sm:col-span-2">{t('form.openHint')}</p>
      <Field label={t('form.mode')}>
        {(field) => (
          <Select {...field} {...form.register('mode')}>
            {ATTENDANCE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`mode.${mode}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('form.note')} error={messages.validation(form.formState.errors.note)}>
        {(field) => (
          <Input {...field} maxLength={200} autoComplete="off" {...form.register('note')} />
        )}
      </Field>
      {update.isError && (
        <div className="sm:col-span-2">
          <Alert tone="danger">{errors.apiError(update.error)}</Alert>
        </div>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? t('form.saving') : t('form.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}
