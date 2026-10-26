import { zodResolver } from '@hookform/resolvers/zod';
import type { ReviewCycle } from '@intime/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { CycleCard } from './CycleCard';
import { cycleFormSchema, emptyCycle, toCreateCycle, type CycleFormValues } from './forms';
import { useCreateCycle, useCycles } from './hooks';
import { useReviewErrors } from './use-review-errors';

function NewCycle({ cycles, onDone }: { cycles: ReviewCycle[]; onDone: () => void }) {
  const { t } = useTranslation('reviews');
  const messages = useMessages();
  const errors = useReviewErrors();
  const create = useCreateCycle();
  const form = useForm<CycleFormValues>({
    resolver: zodResolver(cycleFormSchema),
    defaultValues: emptyCycle(),
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-2"
      aria-label={t('cycles.newTitle')}
      onSubmit={form.handleSubmit((v) => create.mutate(toCreateCycle(v), { onSuccess: onDone }))}
    >
      <div className="sm:col-span-2">
        <Field label={t('cycles.name')} error={messages.validation(e.name)}>
          {(field) => (
            <Input {...field} maxLength={80} autoComplete="off" {...form.register('name')} />
          )}
        </Field>
      </div>
      <Field label={t('cycles.periodStart')} error={messages.validation(e.periodStart)}>
        {(field) => <Input {...field} type="date" {...form.register('periodStart')} />}
      </Field>
      <Field label={t('cycles.periodEnd')} error={messages.validation(e.periodEnd)}>
        {(field) => <Input {...field} type="date" {...form.register('periodEnd')} />}
      </Field>
      <Field label={t('cycles.selfDue')} error={messages.validation(e.selfDue)}>
        {(field) => <Input {...field} type="date" {...form.register('selfDue')} />}
      </Field>
      <Field label={t('cycles.managerDue')} error={messages.validation(e.managerDue)}>
        {(field) => <Input {...field} type="date" {...form.register('managerDue')} />}
      </Field>
      {cycles.length > 0 && (
        <div className="sm:col-span-2">
          <Field label={t('cycles.copyFrom')} hint={t('cycles.copyHint')}>
            {(field) => (
              <Select {...field} {...form.register('copyFromCycleId')}>
                <option value="">{t('cycles.copyNone')}</option>
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}
      {create.isError && (
        <div className="sm:col-span-2">
          <Alert tone="danger">{errors.apiError(create.error)}</Alert>
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={create.isPending}>
          {t('cycles.create')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('cycles.cancel')}
        </Button>
      </div>
    </form>
  );
}

export function CyclesTab({ onShowReviews }: { onShowReviews: (id: string) => void }) {
  const { t } = useTranslation('reviews');
  const errors = useReviewErrors();
  const query = useCycles();
  const [creating, setCreating] = useState(false);
  if (query.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  }
  if (!query.data) return <Alert tone="danger">{errors.apiError(query.error)}</Alert>;
  return (
    <div className="space-y-4">
      {!creating && <Button onClick={() => setCreating(true)}>{t('cycles.new')}</Button>}
      {creating && (
        <Card className="space-y-3">
          <h2 className="text-base font-semibold">{t('cycles.newTitle')}</h2>
          <NewCycle cycles={query.data.items} onDone={() => setCreating(false)} />
        </Card>
      )}
      {query.data.items.length === 0 ? (
        <Card>
          <p className="text-center text-sm text-muted-foreground">{t('cycles.empty')}</p>
        </Card>
      ) : (
        query.data.items.map((c) => (
          <CycleCard key={c.id} cycle={c} onShowReviews={onShowReviews} />
        ))
      )}
    </div>
  );
}
