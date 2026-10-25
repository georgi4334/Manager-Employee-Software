import { zodResolver } from '@hookform/resolvers/zod';
import type { TimeEntry } from '@intime/contracts';
import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import {
  emptyEntry,
  entryFormSchema,
  toCreateEntry,
  toUpdateEntry,
  valuesOfEntry,
  type EntryFormValues,
} from './forms';
import { useCreateEntry, useUpdateEntry } from './hooks';
import { TargetFields } from './targets';
import { useTimeErrors } from './use-time-errors';

interface EntryFormProps {
  /** Editing this entry; adding a new one when omitted. */
  entry?: TimeEntry;
  defaultDate: string;
  onDone: () => void;
}

export function EntryForm({ entry, defaultDate, onDone }: EntryFormProps) {
  const { t } = useTranslation('time');
  const messages = useMessages();
  const errors = useTimeErrors();
  const create = useCreateEntry();
  const update = useUpdateEntry(entry?.id ?? '');
  const initial = useMemo(
    () => (entry ? valuesOfEntry(entry) : emptyEntry(defaultDate)),
    [entry, defaultDate],
  );
  const form = useForm<EntryFormValues>({
    resolver: zodResolver(entryFormSchema),
    defaultValues: initial,
  });
  const fieldErrors = form.formState.errors;
  const mutation = entry ? update : create;

  const submit = form.handleSubmit((v) => {
    if (entry) {
      const body = toUpdateEntry(v, initial);
      if (Object.keys(body).length === 0) return onDone();
      update.mutate(body, { onSuccess: onDone });
    } else {
      create.mutate(toCreateEntry(v), { onSuccess: onDone });
    }
  });

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      aria-label={entry ? t('entry.editTitle') : t('entry.addTitle')}
      onSubmit={submit}
    >
      <Controller
        control={form.control}
        name="projectId"
        render={({ field: project }) => (
          <Controller
            control={form.control}
            name="taskId"
            render={({ field: task }) => (
              <TargetFields
                projectId={project.value}
                taskId={task.value}
                onProject={project.onChange}
                onTask={task.onChange}
                projectError={messages.validation(fieldErrors.projectId)}
                current={entry ? { project: entry.project, task: entry.task } : undefined}
              />
            )}
          />
        )}
      />
      <Field label={t('form.date')} error={messages.validation(fieldErrors.workDate)}>
        {(field) => <Input {...field} type="date" {...form.register('workDate')} />}
      </Field>
      <Field
        label={t('form.duration')}
        hint={t('form.durationHint')}
        error={messages.validation(fieldErrors.duration)}
      >
        {(field) => (
          <Input {...field} inputMode="text" autoComplete="off" {...form.register('duration')} />
        )}
      </Field>
      <div className="sm:col-span-2">
        <Field label={t('form.note')} error={messages.validation(fieldErrors.note)}>
          {(field) => (
            <Input {...field} maxLength={500} autoComplete="off" {...form.register('note')} />
          )}
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" className="size-5" {...form.register('isBillable')} />
        {t('form.billable')}
      </label>
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
