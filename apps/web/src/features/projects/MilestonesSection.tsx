import { zodResolver } from '@hookform/resolvers/zod';
import type { Milestone, ProjectDetail } from '@intime/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { formatDay } from '@/shared/lib/format';
import { milestoneFormSchema, toMilestone, type MilestoneFormValues } from './forms';
import { useCreateMilestone, useDeleteMilestone, useUpdateMilestone } from './hooks';
import { useProjectErrors } from './use-project-errors';

export function MilestonesSection({ project, today }: { project: ProjectDetail; today: string }) {
  const { t } = useTranslation('projects');
  const [adding, setAdding] = useState(false);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t('milestones.title')}</CardTitle>
        {project.canEdit && !adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            {t('milestones.add')}
          </Button>
        )}
      </div>
      {adding && (
        <MilestoneForm projectId={project.id} today={today} onDone={() => setAdding(false)} />
      )}
      {project.milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('milestones.empty')}</p>
      ) : (
        <ul className="space-y-2" aria-label={t('milestones.title')}>
          {project.milestones.map((m) => (
            <MilestoneRow
              key={m.id}
              projectId={project.id}
              milestone={m}
              canEdit={project.canEdit}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function MilestoneRow({
  projectId,
  milestone,
  canEdit,
}: {
  projectId: string;
  milestone: Milestone;
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation('projects');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useProjectErrors();
  const update = useUpdateMilestone(projectId, milestone.id);
  const remove = useDeleteMilestone(projectId);
  const done = milestone.status === 'done';
  const error = update.error ?? remove.error;

  return (
    <li className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={done ? 'font-medium line-through' : 'font-medium'}>{milestone.title}</p>
          <p className="text-sm text-muted-foreground">
            {done && milestone.doneOn
              ? t('milestones.doneOn', { date: formatDay(milestone.doneOn, language) })
              : t('milestones.due', { date: formatDay(milestone.dueDate, language) })}
          </p>
        </div>
        {milestone.overdueDays > 0 && (
          <span className="rounded-full border border-danger px-2 py-0.5 text-xs text-danger">
            {t('milestones.overdue', { count: milestone.overdueDays })}
          </span>
        )}
        {done && (
          <span className="rounded-full border border-success px-2 py-0.5 text-xs text-success">
            {t('milestones.done')}
          </span>
        )}
      </div>
      {error && <Alert tone="danger">{errors.apiError(error)}</Alert>}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={update.isPending}
            onClick={() => update.mutate({ status: done ? 'open' : 'done' })}
          >
            {done ? t('milestones.reopen') : t('milestones.finish')}
          </Button>
          <Button
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => remove.mutate(milestone.id)}
          >
            {t('milestones.delete')}
          </Button>
        </div>
      )}
    </li>
  );
}

function MilestoneForm({
  projectId,
  today,
  onDone,
}: {
  projectId: string;
  today: string;
  onDone: () => void;
}) {
  const { t } = useTranslation('projects');
  const messages = useMessages();
  const errors = useProjectErrors();
  const create = useCreateMilestone(projectId);
  const form = useForm<MilestoneFormValues>({
    resolver: zodResolver(milestoneFormSchema),
    defaultValues: { title: '', dueDate: today },
  });
  const fieldErrors = form.formState.errors;

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      aria-label={t('milestones.add')}
      onSubmit={form.handleSubmit((v) => create.mutate(toMilestone(v), { onSuccess: onDone }))}
    >
      <Field label={t('milestones.name')} error={messages.validation(fieldErrors.title)}>
        {(field) => (
          <Input {...field} maxLength={120} autoComplete="off" {...form.register('title')} />
        )}
      </Field>
      <Field label={t('milestones.dueDate')} error={messages.validation(fieldErrors.dueDate)}>
        {(field) => <Input {...field} type="date" {...form.register('dueDate')} />}
      </Field>
      {create.isError && (
        <div className="sm:col-span-2">
          <Alert tone="danger">{errors.apiError(create.error)}</Alert>
        </div>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? t('form.saving') : t('form.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}
