import type { ReviewCycleStatus, ReviewSummary } from '@intime/contracts';
import { AlertTriangle, CheckCircle2, Circle, EyeOff, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

/** One colour per cycle stage; the stage is always also written in words. */
export const STATUS_STYLE: Record<ReviewCycleStatus, { edge: string; pill: string }> = {
  draft: { edge: 'bg-muted-foreground', pill: 'border-border text-muted-foreground' },
  open: { edge: 'bg-info', pill: 'border-info text-info' },
  calibration: { edge: 'bg-warning', pill: 'border-warning text-warning' },
  closed: { edge: 'bg-success', pill: 'border-success text-success' },
};

export function StatusPill({ status }: { status: ReviewCycleStatus }) {
  const { t } = useTranslation('reviews');
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        STATUS_STYLE[status].pill,
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}

/** A rating out of 5 as five dots (decoration; the number is always written next to it). */
export function RatingDots({ rating, className }: { rating: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('flex gap-1', className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={cn('size-2.5 rounded-full', n <= rating ? 'bg-primary' : 'bg-secondary')}
        />
      ))}
    </span>
  );
}

/** A score out of 5 as a segmented bar with the number and the words. */
export function ScoreBar({ score }: { score: number | null }) {
  const { t } = useTranslation('reviews');
  if (score === null) return <p className="text-sm text-muted-foreground">{t('score.none')}</p>;
  return (
    <div className="space-y-1.5">
      <span aria-hidden="true" className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className={cn('h-1.5 flex-1 rounded-full', n <= score ? 'bg-primary' : 'bg-secondary')}
          />
        ))}
      </span>
      <p className="text-sm">
        <span className="font-semibold tabular-nums">{score}</span>
        {' · '}
        {t(`score.${String(score) as '1'}`)}
      </p>
    </div>
  );
}

type StepState = 'done' | 'open' | 'overdue' | 'hidden';

const STEP_ICON: Record<StepState, { icon: LucideIcon; tone: string }> = {
  done: { icon: CheckCircle2, tone: 'text-success' },
  open: { icon: Circle, tone: 'text-muted-foreground' },
  overdue: { icon: AlertTriangle, tone: 'text-danger' },
  hidden: { icon: EyeOff, tone: 'text-muted-foreground' },
};

const partState = (submitted: boolean | null, overdue: boolean | null): StepState =>
  submitted === null ? 'hidden' : submitted ? 'done' : overdue ? 'overdue' : 'open';

const STATE_WORD: Record<StepState, 'submitted' | 'open' | 'overdue' | 'unknown'> = {
  done: 'submitted',
  open: 'open',
  overdue: 'overdue',
  hidden: 'unknown',
};

/** Where a review stands: self-review, manager review, release. Each step says its state in words. */
export function ReviewSteps({
  review,
  compact = false,
  className,
}: {
  review: Pick<
    ReviewSummary,
    'selfSubmitted' | 'selfOverdue' | 'managerSubmitted' | 'managerOverdue' | 'released'
  >;
  /** Rows without boxes, for narrow cards. */
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation('reviews');
  const self = partState(review.selfSubmitted, review.selfOverdue);
  const manager = partState(review.managerSubmitted, review.managerOverdue);
  const steps: { key: string; state: StepState; text: string }[] = [
    { key: 'self', state: self, text: t('card.self', { state: t(`state.${STATE_WORD[self]}`) }) },
    {
      key: 'manager',
      state: manager,
      text: t('card.manager', { state: t(`state.${STATE_WORD[manager]}`) }),
    },
    {
      key: 'released',
      state: review.released ? 'done' : 'open',
      text: review.released ? t('card.released') : t('card.notReleased'),
    },
  ];
  return (
    <ol
      aria-label={t('card.progress')}
      className={cn(compact ? 'space-y-1.5' : 'grid gap-2 sm:grid-cols-3', className)}
    >
      {steps.map((step, index) => {
        const { icon: Icon, tone } = STEP_ICON[step.state];
        return (
          <li
            key={step.key}
            className={cn(
              'flex min-w-0 items-start gap-2 text-sm',
              !compact && 'rounded-lg border px-2.5 py-2',
              !compact && (step.state === 'overdue' ? 'border-danger' : 'border-border'),
              compact && step.state === 'overdue' && 'font-medium text-danger',
            )}
          >
            <span className="mt-0.5 flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums text-muted-foreground">
              <Icon className={cn('size-4', tone)} aria-hidden="true" />
              <span aria-hidden="true">{index + 1}</span>
            </span>
            <span className="min-w-0 break-words leading-snug">{step.text}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** A date line with an icon. */
export function DateFact({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}
