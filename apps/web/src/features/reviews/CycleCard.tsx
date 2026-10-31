import { zodResolver } from '@hookform/resolvers/zod';
import { REVIEW_CYCLE_STATUSES, todayIn, type ReviewCycle } from '@intime/contracts';
import type { TFunction } from 'i18next';
import { CalendarRange, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { useCurrentUser } from '@/features/auth/use-auth';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';
import { Tile } from '@/shared/ui/tiles';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { competencyFormSchema, type CompetencyFormValues } from './forms';
import { useAddCompetency, useDeleteCycle, useMoveCycle, useRemoveCompetency } from './hooks';
import { MilestoneTrack, type MilestonePoint } from '@/shared/ui/milestone-track';
import { STATUS_STYLE, StatusPill } from './ui';
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
  const { t } = useTranslation('reviews');
  const { data: user } = useCurrentUser();
  const today = todayIn(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const errors = useReviewErrors();
  const move = useMoveCycle(cycle.id);
  const remove = useDeleteCycle();
  const removeCompetency = useRemoveCompetency(cycle.id);
  const [confirming, setConfirming] = useState<'step' | 'delete' | null>(null);
  const step = cycle.status === 'closed' ? null : STEPS[cycle.status];
  const error = move.error ?? remove.error ?? removeCompetency.error;
  const p = cycle.progress;

  const stage = REVIEW_CYCLE_STATUSES.indexOf(cycle.status);

  return (
    <article
      aria-label={cycle.name}
      className="relative space-y-4 overflow-hidden rounded-xl glass p-4 pl-5 sm:p-5 sm:pl-6"
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-1.5', STATUS_STYLE[cycle.status].edge)}
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <Tile>
            <CalendarRange className="size-5" />
          </Tile>
          <h2 className="min-w-0 break-words text-base font-semibold">{cycle.name}</h2>
        </div>
        <StatusPill status={cycle.status} />
      </div>

      {/* The four stages; a cycle only moves forward, one step at a time. */}
      <ol aria-label={t('cycles.stages')} className="grid grid-cols-4 gap-1.5">
        {REVIEW_CYCLE_STATUSES.map((s, index) => (
          <li key={s} className="min-w-0 space-y-1">
            <span
              aria-hidden="true"
              className={cn(
                'block h-1.5 rounded-full',
                index <= stage ? STATUS_STYLE[cycle.status].edge : 'bg-secondary',
              )}
            />
            <span
              className={cn(
                'block truncate text-xs',
                index === stage ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}
              aria-current={index === stage ? 'step' : undefined}
            >
              {t(`status.${s}`)}
            </span>
          </li>
        ))}
      </ol>

      <MilestoneTrack
        points={cyclePoints(cycle, today, t)}
        today={today}
        label={t('cycles.dates')}
      />

      {p && (
        <section aria-label={t('cycles.progress')} className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <ProgressBar label={t('cycles.bar.self')} value={p.selfSubmitted} total={p.total} />
            <ProgressBar
              label={t('cycles.bar.manager')}
              value={p.managerSubmitted}
              total={p.total}
            />
            <ProgressBar label={t('cycles.bar.released')} value={p.released} total={p.total} />
          </div>
          <p className="text-xs text-muted-foreground">{t('cycles.progressText', { ...p })}</p>
        </section>
      )}

      {cycle.competencies.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('cycles.competencyHeading')}</h3>
          <ul
            className="flex flex-wrap gap-2"
            aria-label={t('cycles.competencies', { name: cycle.name })}
          >
            {cycle.competencies.map((c) => (
              <li
                key={c.id}
                className="flex max-w-full items-center gap-1 rounded-full border border-border bg-surface py-1 pl-3 pr-1 text-sm"
                title={c.description ?? undefined}
              >
                <span className="min-w-0 break-words">{c.name}</span>
                {cycle.status === 'draft' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('cycles.removeCompetency', { name: c.name })}
                    disabled={removeCompetency.isPending}
                    onClick={() => removeCompetency.mutate(c.id)}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                )}
                {cycle.status !== 'draft' && <span className="w-2" aria-hidden="true" />}
              </li>
            ))}
          </ul>
        </section>
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
    </article>
  );
}

function ProgressBar({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">
          {value}/{total}
        </span>
      </div>
      <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-secondary">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/**
 * The cycle's dates on a milestone track. A deadline that passed while the cycle was still open and parts are
 * missing is "late" (only cycle managers see the counts); a closed cycle is done throughout.
 */
export function cyclePoints(
  cycle: ReviewCycle,
  today: string,
  t: TFunction<'reviews'>,
): MilestonePoint[] {
  const p = cycle.progress;
  const missing = {
    selfDue: p !== null && p.selfSubmitted < p.total,
    managerDue: p !== null && p.managerSubmitted < p.total,
  };
  const points = (['periodStart', 'periodEnd', 'selfDue', 'managerDue'] as const)
    .map((key): MilestonePoint => {
      const date = cycle[key];
      const passed = cycle.status === 'closed' || date < today;
      const late =
        passed &&
        cycle.status === 'open' &&
        (key === 'selfDue' || key === 'managerDue') &&
        missing[key];
      return {
        key,
        label: t(`cycles.${key}`),
        date,
        state: late ? 'late' : passed ? 'done' : 'upcoming',
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const next = points.findIndex((point) => point.state === 'upcoming');
  if (next >= 0) points[next] = { ...points[next]!, state: 'next' };
  return points;
}
