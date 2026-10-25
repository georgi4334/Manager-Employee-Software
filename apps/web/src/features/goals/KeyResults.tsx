import { zodResolver } from '@hookform/resolvers/zod';
import { MAX_KEY_RESULTS, type GoalDetail, type KeyResult } from '@intime/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { formatNumber } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import {
  currentValueSchema,
  emptyKeyResult,
  keyResultFormSchema,
  toCreateKeyResult,
  toCurrentValue,
  type CurrentValueFormValues,
  type KeyResultFormValues,
} from './forms';
import { useAddKeyResult, useRemoveKeyResult, useUpdateKeyResult } from './hooks';
import { ProgressBar } from './ProgressBar';
import { useGoalErrors } from './use-goal-errors';

function KeyResultRow({
  goalId,
  kr,
  canEdit,
}: {
  goalId: string;
  kr: KeyResult;
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation('goals');
  const language = i18n.resolvedLanguage ?? 'en';
  const messages = useMessages();
  const errors = useGoalErrors();
  const update = useUpdateKeyResult(goalId);
  const remove = useRemoveKeyResult(goalId);
  const form = useForm<CurrentValueFormValues>({
    resolver: zodResolver(currentValueSchema),
    defaultValues: { currentValue: String(kr.currentValue) },
  });
  const unit = kr.unit ? ` ${kr.unit}` : '';
  const error = update.error ?? remove.error;

  return (
    <li className="space-y-2 rounded-lg border border-border p-3">
      <p className="break-words font-medium">{kr.title}</p>
      <p className="text-sm text-muted-foreground">
        {t('kr.range', {
          start: `${formatNumber(kr.startValue, language)}${unit}`,
          current: `${formatNumber(kr.currentValue, language)}${unit}`,
          target: `${formatNumber(kr.targetValue, language)}${unit}`,
        })}
      </p>
      <ProgressBar pct={kr.progressPct} label={t('progressOf', { title: kr.title })} />
      {error && <Alert tone="danger">{errors.apiError(error)}</Alert>}
      {canEdit && (
        <form
          noValidate
          className="flex flex-wrap items-end gap-2"
          aria-label={t('kr.updateLabel', { title: kr.title })}
          onSubmit={form.handleSubmit((v) => update.mutate({ id: kr.id, body: toCurrentValue(v) }))}
        >
          <div className="w-40">
            <Field
              label={t('kr.current')}
              error={messages.validation(form.formState.errors.currentValue)}
            >
              {(field) => (
                <Input {...field} inputMode="decimal" {...form.register('currentValue')} />
              )}
            </Field>
          </div>
          <Button type="submit" variant="secondary" disabled={update.isPending}>
            {t('kr.update')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => remove.mutate(kr.id)}
          >
            {t('kr.remove')}
          </Button>
        </form>
      )}
    </li>
  );
}

function NewKeyResult({ goalId }: { goalId: string }) {
  const { t } = useTranslation('goals');
  const messages = useMessages();
  const errors = useGoalErrors();
  const add = useAddKeyResult(goalId);
  const form = useForm<KeyResultFormValues>({
    resolver: zodResolver(keyResultFormSchema),
    defaultValues: emptyKeyResult(),
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-2"
      aria-label={t('kr.newTitle')}
      onSubmit={form.handleSubmit((v) =>
        add.mutate(toCreateKeyResult(v), { onSuccess: () => form.reset(emptyKeyResult()) }),
      )}
    >
      <div className="sm:col-span-2">
        <Field label={t('kr.title')} error={messages.validation(e.title)}>
          {(field) => (
            <Input {...field} maxLength={120} autoComplete="off" {...form.register('title')} />
          )}
        </Field>
      </div>
      <Field label={t('kr.unit')} error={messages.validation(e.unit)}>
        {(field) => <Input {...field} maxLength={20} {...form.register('unit')} />}
      </Field>
      <Field label={t('kr.start')} error={messages.validation(e.startValue)}>
        {(field) => <Input {...field} inputMode="decimal" {...form.register('startValue')} />}
      </Field>
      <Field label={t('kr.target')} error={messages.validation(e.targetValue)}>
        {(field) => <Input {...field} inputMode="decimal" {...form.register('targetValue')} />}
      </Field>
      <Field label={t('kr.current')} error={messages.validation(e.currentValue)}>
        {(field) => <Input {...field} inputMode="decimal" {...form.register('currentValue')} />}
      </Field>
      {add.isError && (
        <div className="sm:col-span-2">
          <Alert tone="danger">{errors.apiError(add.error)}</Alert>
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={add.isPending}>
          {t('kr.add')}
        </Button>
      </div>
    </form>
  );
}

export function KeyResults({ goal }: { goal: GoalDetail }) {
  const { t } = useTranslation('goals');
  const [adding, setAdding] = useState(false);
  const full = goal.keyResults.length >= MAX_KEY_RESULTS;
  return (
    <section aria-labelledby="kr-heading" className="space-y-3">
      <h2 id="kr-heading" className="text-base font-semibold">
        {t('kr.heading')}
      </h2>
      {goal.keyResults.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('kr.none')}</p>
      ) : (
        <ul className="space-y-2" aria-labelledby="kr-heading">
          {goal.keyResults.map((kr) => (
            <KeyResultRow key={kr.id} goalId={goal.id} kr={kr} canEdit={goal.canEdit} />
          ))}
        </ul>
      )}
      {goal.canEdit && !full && !adding && (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          {t('kr.new')}
        </Button>
      )}
      {goal.canEdit && adding && <NewKeyResult goalId={goal.id} />}
    </section>
  );
}
