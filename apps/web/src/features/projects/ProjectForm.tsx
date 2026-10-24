import { zodResolver } from '@hookform/resolvers/zod';
import { PROJECT_PRIORITIES, PROJECT_STATUSES, type ProjectDetail } from '@intime/contracts';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { usePermission } from '@/features/auth/permissions';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import {
  emptyProject,
  projectFormSchema,
  toCreateProject,
  toUpdateProject,
  valuesOfProject,
  type ProjectFormValues,
} from './forms';
import { useClients, useCreateProject, useUpdateProject } from './hooks';
import { PersonPicker } from './PersonPicker';
import { useProjectErrors } from './use-project-errors';

interface ProjectFormProps {
  /** Editing this project; creating one when omitted. */
  project?: ProjectDetail;
  today: string;
  onDone: (id?: string) => void;
}

/** Create or change a project. Which fields are offered is cosmetic; the server decides. */
export function ProjectForm({ project, today, onDone }: ProjectFormProps) {
  const { t } = useTranslation('projects');
  const messages = useMessages();
  const errors = useProjectErrors();
  const seesClients = usePermission('client.view');
  const nameLead = usePermission('project.manage', 'all');
  const clients = useClients(seesClients);
  const create = useCreateProject();
  const update = useUpdateProject(project?.id ?? '');
  const mutation = project ? update : create;
  const initial = project ? valuesOfProject(project) : emptyProject(today);
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: initial,
  });
  const fieldErrors = form.formState.errors;
  const activeClients = (clients.data?.items ?? []).filter(
    (c) => c.status === 'active' || c.id === initial.clientId,
  );

  const submit = (v: ProjectFormValues) => {
    if (project) {
      const body = toUpdateProject(v, initial);
      if (Object.keys(body).length === 0) return onDone();
      update.mutate(body, { onSuccess: () => onDone() });
    } else {
      create.mutate(toCreateProject(v), { onSuccess: (created) => onDone(created.id) });
    }
  };

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={form.handleSubmit(submit)}
      aria-label={project ? t('form.editTitle') : t('form.newTitle')}
    >
      <Field
        label={t('form.code')}
        hint={t('form.codeHint')}
        error={messages.validation(fieldErrors.code)}
      >
        {(field) => (
          <Input
            {...field}
            maxLength={12}
            autoComplete="off"
            className="uppercase"
            {...form.register('code')}
          />
        )}
      </Field>
      <Field label={t('form.name')} error={messages.validation(fieldErrors.name)}>
        {(field) => (
          <Input {...field} maxLength={120} autoComplete="off" {...form.register('name')} />
        )}
      </Field>
      <div className="sm:col-span-2">
        <Field label={t('form.description')} error={messages.validation(fieldErrors.description)}>
          {(field) => (
            <Input
              {...field}
              maxLength={1000}
              autoComplete="off"
              {...form.register('description')}
            />
          )}
        </Field>
      </div>
      {seesClients && (
        <Field label={t('form.client')}>
          {(field) => (
            <Select {...field} {...form.register('clientId')}>
              <option value="">{t('form.noClient')}</option>
              {activeClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field label={t('form.status')}>
        {(field) => (
          <Select {...field} {...form.register('status')}>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('form.priority')}>
        {(field) => (
          <Select {...field} {...form.register('priority')}>
            {PROJECT_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label={t('form.budget')}
        hint={t('form.budgetHint')}
        error={messages.validation(fieldErrors.budgetHours)}
      >
        {(field) => (
          <Input
            {...field}
            inputMode="decimal"
            autoComplete="off"
            {...form.register('budgetHours')}
          />
        )}
      </Field>
      <Field label={t('form.start')} error={messages.validation(fieldErrors.startDate)}>
        {(field) => <Input {...field} type="date" {...form.register('startDate')} />}
      </Field>
      <Field label={t('form.end')} error={messages.validation(fieldErrors.endDate)}>
        {(field) => <Input {...field} type="date" {...form.register('endDate')} />}
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" className="size-5" {...form.register('isBillable')} />
        {t('form.billable')}
      </label>
      {nameLead ? (
        <div className="sm:col-span-2">
          <Controller
            control={form.control}
            name="leadEmployeeId"
            render={({ field }) => (
              <PersonPicker
                label={t('form.lead')}
                value={field.value}
                onChange={field.onChange}
                current={
                  project?.lead
                    ? {
                        id: project.lead.id,
                        name: `${project.lead.firstName} ${project.lead.lastName}`,
                      }
                    : null
                }
                emptyLabel={t('form.noLead')}
              />
            )}
          />
        </div>
      ) : (
        !project && (
          <p className="text-sm text-muted-foreground sm:col-span-2">{t('form.leadSelf')}</p>
        )
      )}
      {mutation.isError && (
        <div className="sm:col-span-2">
          <Alert tone="danger">{errors.apiError(mutation.error)}</Alert>
        </div>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t('form.saving') : t('form.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone()}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}
