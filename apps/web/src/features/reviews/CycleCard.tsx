import { zodResolver } from '@hookform/resolvers/zod';
import type { ReviewCycle } from '@intime/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { formatDay } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { competencyFormSchema, type CompetencyFormValues } from './forms';
import { useAddCompetency, useDeleteCycle, useMoveCycle, useRemoveCompetency } from './hooks';
import { useReviewErrors } from './use-review-errors';

const STEPS = { draft: 'open', open: 'calibrate', calibration: 'close' } as const;

function NewCompetency({ cycleId }: { cycleId: string }) {
  const { t } = useTranslation('reviews');
  const messages = useMessages();
  const errors = useReviewErrors();
  const add = useAddCompetency(cycleId);
  const form = useForm<CompetencyFormValues>({
    resolver: zodResolver(competencyFormSchema),
    defaultValues: { name: '', description: '' },
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-2"
      aria-label={t('cycles.newCompetency')}
      onSubmit={form.handleSubmit((v) =>
        add.mutate(
          {
            name: v.name.trim(),
            ...(v.description.trim() ? { description: v.description.trim() } : {}),
          },
          { onSuccess: () => form.reset({ name: '', description: '' }) },
        ),
      )}
    >
      <Field label={t('cycles.competencyName')} error={messages.validation(e.name)}>
        {(field) => (
          <Input {...field} maxLength={60} autoComplete="off" {...form.register('name')} />
        )}
      </Field>
      <Field label={t('cycles.competencyDescription')} error={messages.validation(e.description)}>
        {(field) => (
          <Input {...field} maxLength={300} autoComplete="off" {...form.register('description')} />
        )}
      </Field>
      {add.isError && (
        <div className="sm:col-span-2">
          <Alert tone="danger">{errors.apiError(add.error)}</Alert>
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={add.isPending}>
          {t('cycles.addCompetency')}
        </Button>
      </div>
    </form>
  );
}

export function CycleCard({
  cycle,
  onShowReviews,
}: {
  cycle: ReviewCycle;
  onShowReviews: (id: string) => void;
}) {
  const { t, i18n } = useTranslation('reviews');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useReviewErrors();
  const move = useMoveCycle(cycle.id);
  const remove = useDeleteCycle();
  const removeCompetency = useRemoveCompetency(cycle.id);
  const [confirming, setConfirming] = useState<'step' | 'delete' | null>(null);
  const step = cycle.status === 'closed' ? null : STEPS[cycle.status];
  const error = move.error ?? remove.error ?? removeCompetency.error;
  const p = cycle.progress;

  return (
    <Card className="space-y-3">
      <div className="space-y-1">
        <h2 className="break-words text-base font-semibold">{cycle.name}</h2>
        <p className="text-sm text-muted-foreground">
          {t(`status.${cycle.status}`)}
          {' · '}
          {t('detail.period', {
            from: formatDay(cycle.periodStart, language),
            to: formatDay(cycle.periodEnd, language),
          })}
          {' · '}
          {t('detail.dues', {
            self: formatDay(cycle.selfDue, language),
            manager: formatDay(cycle.managerDue, language),
          })}
        </p>
        {p && (
          <p className="text-sm" aria-label={t('cycles.progress')}>
            {t('cycles.progressText', { ...p })}
          </p>
        )}
      </div>

      {cycle.competencies.length > 0 && (
        <ul className="space-y-1" aria-label={t('cycles.competencies', { name: cycle.name })}>
          {cycle.competencies.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="break-words">
                {c.name}
                {c.description && <span className="text-muted-foreground"> — {c.description}</span>}
              </span>
              {cycle.status === 'draft' && (
                <Button
                  variant="ghost"
                  aria-label={t('cycles.removeCompetency', { name: c.name })}
                  disabled={removeCompetency.isPending}
                  onClick={() => removeCompetency.mutate(c.id)}
                >
                  {t('cycles.remove')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {cycle.status === 'draft' && <NewCompetency cycleId={cycle.id} />}

      {error && <Alert tone="danger">{errors.apiError(error)}</Alert>}
      <div className="flex flex-wrap gap-2">
        {cycle.status !== 'draft' && (
          <Button variant="secondary" onClick={() => onShowReviews(cycle.id)}>
            {t('cycles.showReviews', { name: cycle.name })}
          </Button>
        )}
        {step &&
          (confirming === 'step' ? (
            <>
              <Button
                disabled={move.isPending}
                onClick={() => move.mutate(step, { onSuccess: () => setConfirming(null) })}
              >
                {t(`cycles.confirm.${step}`)}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                {t('cycles.cancel')}
              </Button>
            </>
          ) : (
            <Button onClick={() => setConfirming('step')}>
              {t(`cycles.step.${step}`, { name: cycle.name })}
            </Button>
          ))}
        {cycle.status === 'draft' &&
          (confirming === 'delete' ? (
            <>
              <Button disabled={remove.isPending} onClick={() => remove.mutate(cycle.id)}>
                {t('cycles.confirmDelete')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                {t('cycles.cancel')}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirming('delete')}>
              {t('cycles.delete', { name: cycle.name })}
            </Button>
          ))}
      </div>
    </Card>
  );
}
