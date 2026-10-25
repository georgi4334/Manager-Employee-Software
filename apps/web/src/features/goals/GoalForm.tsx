import { zodResolver } from '@hookform/resolvers/zod';
import { GOAL_SCOPES, GOAL_STATUSES, canAlign, type GoalDetail } from '@intime/contracts';
import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { useEmployees } from '@/features/employees/hooks';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import {
  emptyGoal,
  goalFormSchema,
  toCreateGoal,
  toUpdateGoal,
  valuesOfGoal,
  type GoalFormValues,
} from './forms';
import { useCreateGoal, useGoals, useGoalTeams, useUpdateGoal } from './hooks';
import { useGoalErrors } from './use-goal-errors';

interface GoalFormProps {
  /** Editing this goal; creating a new one when omitted. */
  goal?: GoalDetail;
  /** The scopes a new goal can have (what the caller may set). */
  scopes?: readonly (typeof GOAL_SCOPES)[number][];
  onDone: (id?: string) => void;
}

export function GoalForm({ goal, scopes = GOAL_SCOPES, onDone }: GoalFormProps) {
  const { t } = useTranslation('goals');
  const messages = useMessages();
  const errors = useGoalErrors();
  const create = useCreateGoal();
  const update = useUpdateGoal(goal?.id ?? '');
  const initial = useMemo(() => (goal ? valuesOfGoal(goal) : emptyGoal(scopes[0])), [goal, scopes]);
  const form = useForm<GoalFormValues>({
    resolver: zodResolver(goalFormSchema),
    defaultValues: initial,
  });
  const fieldErrors = form.formState.errors;
  const scope = useWatch({ control: form.control, name: 'scope' });
  const teams = useGoalTeams();
  const people = useEmployees({ q: '', status: 'active', page: 1 });
  const candidates = useGoals({ scope: 'all', status: 'open', q: '', page: 1, pageSize: 100 });
  const parents = (candidates.data?.items ?? []).filter(
    (g) => g.id !== goal?.id && canAlign(scope, g.scope),
  );
  const mutation = goal ? update : create;

  const submit = form.handleSubmit((v) => {
    if (goal) {
      const body = toUpdateGoal(v, initial);
      if (Object.keys(body).length === 0) return onDone();
      update.mutate(body, { onSuccess: () => onDone() });
    } else {
      create.mutate(toCreateGoal(v), { onSuccess: (created) => onDone(created.id) });
    }
  });

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      aria-label={goal ? t('form.editTitle') : t('form.newTitle')}
      onSubmit={submit}
    >
      {!goal && (
        <Field label={t('form.scope')}>
          {(field) => (
            <Select {...field} {...form.register('scope')}>
              {scopes.map((s) => (
                <option key={s} value={s}>
                  {t(`scope.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {!goal && scope === 'team' && (
        <Field label={t('form.team')} error={messages.validation(fieldErrors.teamId)}>
          {(field) => (
            <Select {...field} {...form.register('teamId')}>
              <option value="">—</option>
              {(teams.data?.items ?? []).map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {!goal && scope === 'personal' && (people.data?.items.length ?? 0) > 0 && (
        <Field label={t('form.owner')}>
          {(field) => (
            <Select {...field} {...form.register('employeeId')}>
              <option value="">{t('form.myself')}</option>
              {(people.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </option>
              ))}
            </Select>
          )}
        </Field>
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
              maxLength={1000}
              autoComplete="off"
              {...form.register('description')}
            />
          )}
        </Field>
      </div>
      <Field label={t('form.status')}>
        {(field) => (
          <Select {...field} {...form.register('status')}>
            {GOAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('form.dueDate')} error={messages.validation(fieldErrors.dueDate)}>
        {(field) => <Input {...field} type="date" {...form.register('dueDate')} />}
      </Field>
      {scope !== 'company' && (
        <Field label={t('form.parent')} hint={t('form.parentHint')}>
          {(field) => (
            <Select {...field} {...form.register('parentGoalId')}>
              <option value="">{t('form.noParent')}</option>
              {parents.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title} ({t(`scope.${g.scope}`)})
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {(!goal || goal.keyResults.length === 0) && (
        <Field
          label={t('form.progress')}
          hint={t('form.progressHint')}
          error={messages.validation(fieldErrors.progressPct)}
        >
          {(field) => <Input {...field} inputMode="numeric" {...form.register('progressPct')} />}
        </Field>
      )}
      {mutation.isError && (
        <div className="sm:col-span-2">
          <Alert tone="danger">{errors.apiError(mutation.error)}</Alert>
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          {t('form.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone()}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}
