import { zodResolver } from '@hookform/resolvers/zod';
import {
  PROJECT_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  type ProjectSummary,
  type Task,
} from '@intime/contracts';
import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { useProject } from '@/features/projects/hooks';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import {
  emptyTask,
  taskFormSchema,
  toCreateTask,
  toUpdateTask,
  valuesOfTask,
  type TaskFormValues,
} from './forms';
import { useCreateTask, useUpdateTask } from './hooks';
import { useTaskErrors } from './use-task-errors';

interface TaskFormProps {
  /** Editing this task; creating a new one when omitted. */
  task?: Task;
  /** Projects a new task can be created in (the ones the caller may manage). */
  projects?: ProjectSummary[];
  defaultProjectId?: string;
  onDone: () => void;
}

export function TaskForm({ task, projects = [], defaultProjectId = '', onDone }: TaskFormProps) {
  const { t } = useTranslation('tasks');
  const messages = useMessages();
  const errors = useTaskErrors();
  const create = useCreateTask();
  const update = useUpdateTask(task?.id ?? '');
  const initial = useMemo(
    () => (task ? valuesOfTask(task) : emptyTask(defaultProjectId)),
    [task, defaultProjectId],
  );
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: initial,
  });
  const fieldErrors = form.formState.errors;
  const projectId = useWatch({ control: form.control, name: 'projectId' });
  const project = useProject(projectId);
  const people = useMemo(() => {
    const found = new Map<string, string>();
    const detail = project.data;
    if (detail?.lead) found.set(detail.lead.id, `${detail.lead.firstName} ${detail.lead.lastName}`);
    for (const a of detail?.assignments ?? []) {
      found.set(a.employee.id, `${a.employee.firstName} ${a.employee.lastName}`);
    }
    if (task?.assignee) {
      found.set(task.assignee.id, `${task.assignee.firstName} ${task.assignee.lastName}`);
    }
    return [...found];
  }, [project.data, task]);
  const mutation = task ? update : create;

  const submit = form.handleSubmit((v) => {
    if (task) {
      const body = toUpdateTask(v, initial);
      if (Object.keys(body).length === 0) return onDone();
      update.mutate(body, { onSuccess: onDone });
    } else {
      create.mutate({ projectId: v.projectId, body: toCreateTask(v) }, { onSuccess: onDone });
    }
  });

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      aria-label={task ? t('form.editTitle') : t('form.newTitle')}
      onSubmit={submit}
    >
      {!task && (
        <div className="sm:col-span-2">
          <Field label={t('form.project')} error={messages.validation(fieldErrors.projectId)}>
            {(field) => (
              <Select {...field} {...form.register('projectId')}>
                <option value="">—</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}
      <div className="sm:col-span-2">
        <Field label={t('form.title')} error={messages.validation(fieldErrors.title)}>
          {(field) => (
            <Input {...field} maxLength={120} autoComplete="off" {...form.register('title')} />
          )}
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label={t('form.description')} error={messages.validation(fieldErrors.description)}>
          {(field) => (
            <Input
              {...field}
              maxLength={2000}
              autoComplete="off"
              {...form.register('description')}
            />
          )}
        </Field>
      </div>
      <Field label={t('form.type')}>
        {(field) => (
          <Select {...field} {...form.register('type')}>
            {TASK_TYPES.map((v) => (
              <option key={v} value={v}>
                {t(`type.${v}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('form.status')}>
        {(field) => (
          <Select {...field} {...form.register('status')}>
            {TASK_STATUSES.map((v) => (
              <option key={v} value={v}>
                {t(`status.${v}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('form.priority')}>
        {(field) => (
          <Select {...field} {...form.register('priority')}>
            {PROJECT_PRIORITIES.map((v) => (
              <option key={v} value={v}>
                {t(`priority.${v}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('form.assignee')}>
        {(field) => (
          <Select {...field} {...form.register('assigneeEmployeeId')}>
            <option value="">{t('unassigned')}</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('form.milestone')}>
        {(field) => (
          <Select {...field} {...form.register('milestoneId')}>
            <option value="">{t('form.noMilestone')}</option>
            {(project.data?.milestones ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('form.estimate')} error={messages.validation(fieldErrors.estimateHours)}>
        {(field) => (
          <Input
            {...field}
            inputMode="decimal"
            autoComplete="off"
            {...form.register('estimateHours')}
          />
        )}
      </Field>
      <Field label={t('form.dueDate')} error={messages.validation(fieldErrors.dueDate)}>
        {(field) => <Input {...field} type="date" {...form.register('dueDate')} />}
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
