import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';
import { formatDate, formatDay } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { checkInFormSchema, toCheckIn, type CheckInFormValues } from './forms';
import { GoalForm } from './GoalForm';
import { useCheckIn, useDeleteGoal, useGoal } from './hooks';
import { KeyResults } from './KeyResults';
import { ProgressBar } from './ProgressBar';
import { useGoalErrors } from './use-goal-errors';

function CheckIn({ goalId }: { goalId: string }) {
  const { t } = useTranslation('goals');
  const messages = useMessages();
  const errors = useGoalErrors();
  const checkIn = useCheckIn(goalId);
  const form = useForm<CheckInFormValues>({
    resolver: zodResolver(checkInFormSchema),
    defaultValues: { comment: '' },
  });
  return (
    <form
      noValidate
      className="space-y-3"
      aria-label={t('checkIn.title')}
      onSubmit={form.handleSubmit((v) =>
        checkIn.mutate(toCheckIn(v), { onSuccess: () => form.reset({ comment: '' }) }),
      )}
    >
      <Field
        label={t('checkIn.comment')}
        error={messages.validation(form.formState.errors.comment)}
      >
        {(field) => (
          <Input {...field} maxLength={500} autoComplete="off" {...form.register('comment')} />
        )}
      </Field>
      {checkIn.isError && <Alert tone="danger">{errors.apiError(checkIn.error)}</Alert>}
      <Button type="submit" disabled={checkIn.isPending}>
        {t('checkIn.save')}
      </Button>
    </form>
  );
}

export function GoalDetailPage() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation('goals');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useGoalErrors();
  const navigate = useNavigate();
  const query = useGoal(id);
  const remove = useDeleteGoal();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const goal = query.data;

  if (query.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  }
  if (query.isError || !goal) {
    return (
      <Card className="mx-auto max-w-3xl space-y-3 text-center">
        <Alert tone="danger">
          {isApiError(query.error, 'NOT_FOUND') ? t('notFound') : errors.apiError(query.error)}
        </Alert>
        <Link to="/goals" className="text-primary underline">
          {t('back')}
        </Link>
      </Card>
    );
  }

  const who =
    goal.scope === 'personal'
      ? `${goal.owner.firstName} ${goal.owner.lastName}`
      : goal.scope === 'team'
        ? (goal.team?.name ?? '')
        : t('scope.company');

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/goals" className="text-sm text-primary underline">
        {t('back')}
      </Link>
      <Card className="space-y-3">
        {editing ? (
          <GoalForm goal={goal} onDone={() => setEditing(false)} />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h1 className="break-words text-2xl font-semibold">{goal.title}</h1>
              {goal.overdue && (
                <span className="rounded-full border border-danger px-2 py-0.5 text-xs text-danger">
                  {t('card.overdue')}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {t(`scope.${goal.scope}`)} · {who} · {t(`status.${goal.status}`)}
              {goal.dueDate && ` · ${t('card.due', { date: formatDay(goal.dueDate, language) })}`}
            </p>
            {goal.description && (
              <p className="whitespace-pre-line break-words">{goal.description}</p>
            )}
            <ProgressBar pct={goal.progressPct} label={t('progressOf', { title: goal.title })} />
            {goal.parent && (
              <p className="text-sm">
                {t('alignedTo')}{' '}
                <Link to={`/goals/${goal.parent.id}`} className="text-primary underline">
                  {goal.parent.title}
                </Link>{' '}
                ({t(`scope.${goal.parent.scope}`)})
              </p>
            )}
            {remove.isError && <Alert tone="danger">{errors.apiError(remove.error)}</Alert>}
            {goal.canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  {t('edit')}
                </Button>
                {confirming ? (
                  <>
                    <Button
                      disabled={remove.isPending}
                      onClick={() =>
                        remove.mutate(goal.id, { onSuccess: () => void navigate('/goals') })
                      }
                    >
                      {t('confirmDelete')}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirming(false)}>
                      {t('form.cancel')}
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirming(true)}>
                    {t('delete')}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      <Card>
        <KeyResults goal={goal} />
      </Card>

      {goal.children.length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-base font-semibold">{t('children')}</h2>
          <ul className="space-y-1">
            {goal.children.map((c) => (
              <li key={c.id} className="text-sm">
                <Link to={`/goals/${c.id}`} className="text-primary underline">
                  {c.title}
                </Link>{' '}
                · {t(`scope.${c.scope}`)} · {t('percent', { pct: c.progressPct })}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-3">
        <h2 className="text-base font-semibold">{t('checkIn.heading')}</h2>
        {goal.canEdit && <CheckIn goalId={goal.id} />}
        {goal.updates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('checkIn.none')}</p>
        ) : (
          <ul className="space-y-2" aria-label={t('checkIn.heading')}>
            {goal.updates.map((u) => (
              <li key={u.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="text-muted-foreground">
                  {u.author.firstName} {u.author.lastName} ·{' '}
                  {formatDate(u.createdAt, language, { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                  {t('percent', { pct: u.progressPct })}
                </p>
                {u.comment && <p className="break-words">{u.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
