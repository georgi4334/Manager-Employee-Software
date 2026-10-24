import { zodResolver } from '@hookform/resolvers/zod';
import type { Assignment, ProjectDetail } from '@intime/contracts';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { formatDay } from '@/shared/lib/format';
import {
  assignmentFormSchema,
  toCreateAssignment,
  toUpdateAssignment,
  type AssignmentFormValues,
} from './forms';
import { useCreateAssignment, useDeleteAssignment, useUpdateAssignment } from './hooks';
import { PersonPicker } from './PersonPicker';
import { useProjectErrors } from './use-project-errors';

export function TeamSection({ project, today }: { project: ProjectDetail; today: string }) {
  const { t } = useTranslation('projects');
  const [adding, setAdding] = useState(false);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t('team.title')}</CardTitle>
        {project.canStaff && !adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            {t('team.add')}
          </Button>
        )}
      </div>
      {adding && (
        <AssignmentForm projectId={project.id} today={today} onDone={() => setAdding(false)} />
      )}
      {project.assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('team.empty')}</p>
      ) : (
        <ul className="space-y-2" aria-label={t('team.title')}>
          {project.assignments.map((a) => (
            <AssignmentRow
              key={a.id}
              projectId={project.id}
              assignment={a}
              canStaff={project.canStaff}
              today={today}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function AssignmentRow({
  projectId,
  assignment,
  canStaff,
  today,
}: {
  projectId: string;
  assignment: Assignment;
  canStaff: boolean;
  today: string;
}) {
  const { t, i18n } = useTranslation('projects');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useProjectErrors();
  const remove = useDeleteAssignment(projectId);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="rounded-lg border border-border p-3">
        <AssignmentForm
          projectId={projectId}
          assignment={assignment}
          today={today}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }
  const name = `${assignment.employee.firstName} ${assignment.employee.lastName}`;
  return (
    <li className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{name}</p>
          <p className="text-sm text-muted-foreground">
            {assignment.role ? `${assignment.role} · ` : ''}
            {t('team.allocation', { pct: assignment.allocationPct })}
          </p>
          <p className="text-sm text-muted-foreground">
            {assignment.toDate
              ? t('period', {
                  from: formatDay(assignment.fromDate, language),
                  to: formatDay(assignment.toDate, language),
                })
              : t('since', { from: formatDay(assignment.fromDate, language) })}
          </p>
        </div>
        {assignment.overAllocated && (
          <span className="rounded-full border border-warning px-2 py-0.5 text-xs text-warning">
            {t('team.overAllocated')}
          </span>
        )}
      </div>
      {remove.isError && <Alert tone="danger">{errors.apiError(remove.error)}</Alert>}
      {canStaff && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t('team.edit')}
          </Button>
          <Button
            variant="ghost"
            disabled={remove.isPending}
            aria-label={t('team.removeFor', { name })}
            onClick={() => remove.mutate(assignment.id)}
          >
            {t('team.remove')}
          </Button>
        </div>
      )}
    </li>
  );
}

function AssignmentForm({
  projectId,
  assignment,
  today,
  onDone,
}: {
  projectId: string;
  assignment?: Assignment;
  today: string;
  onDone: () => void;
}) {
  const { t } = useTranslation('projects');
  const messages = useMessages();
  const errors = useProjectErrors();
  const create = useCreateAssignment(projectId);
  const update = useUpdateAssignment(projectId, assignment?.id ?? '');
  const mutation = assignment ? update : create;
  const form = useForm<AssignmentFormValues>({
    resolver: zodResolver(assignmentFormSchema),
    defaultValues: assignment
      ? {
          employeeId: assignment.employee.id,
          role: assignment.role ?? '',
          allocationPct: String(assignment.allocationPct),
          fromDate: assignment.fromDate,
          toDate: assignment.toDate ?? '',
        }
      : { employeeId: '', role: '', allocationPct: '100', fromDate: today, toDate: '' },
  });
  const fieldErrors = form.formState.errors;
  const submit = (v: AssignmentFormValues) => {
    if (assignment) update.mutate(toUpdateAssignment(v), { onSuccess: onDone });
    else create.mutate(toCreateAssignment(v), { onSuccess: onDone });
  };

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      aria-label={assignment ? t('team.edit') : t('team.add')}
      onSubmit={form.handleSubmit(submit)}
    >
      {!assignment && (
        <div className="sm:col-span-2">
          <Controller
            control={form.control}
            name="employeeId"
            render={({ field }) => (
              <PersonPicker
                label={t('team.person')}
                value={field.value}
                onChange={field.onChange}
                error={messages.validation(fieldErrors.employeeId)}
              />
            )}
          />
        </div>
      )}
      <Field label={t('team.role')} error={messages.validation(fieldErrors.role)}>
        {(field) => (
          <Input {...field} maxLength={60} autoComplete="off" {...form.register('role')} />
        )}
      </Field>
      <Field
        label={t('team.allocationLabel')}
        error={messages.validation(fieldErrors.allocationPct)}
      >
        {(field) => (
          <Input
            {...field}
            inputMode="numeric"
            autoComplete="off"
            {...form.register('allocationPct')}
          />
        )}
      </Field>
      <Field label={t('team.from')} error={messages.validation(fieldErrors.fromDate)}>
        {(field) => <Input {...field} type="date" {...form.register('fromDate')} />}
      </Field>
      <Field
        label={t('team.to')}
        hint={t('team.toHint')}
        error={messages.validation(fieldErrors.toDate)}
      >
        {(field) => <Input {...field} type="date" {...form.register('toDate')} />}
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
