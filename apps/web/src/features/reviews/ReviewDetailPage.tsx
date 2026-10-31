import type { Competency, ReviewDetail } from '@intime/contracts';
import { CalendarRange, UserPen, UsersRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { isApiError } from '@/shared/api/api-error';
import { formatDate, formatDay } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { valuesOfPart } from './forms';
import { useCalibrate, useReopen, useReview } from './hooks';
import { PartEditor } from './PartEditor';
import { ScoreSelect } from './ScoreSelect';
import { useReviewErrors } from './use-review-errors';
import { BackLink } from '@/shared/ui/back-link';
import { EmployeeAvatar } from '@/features/employees/EmployeeAvatar';
import { cn } from '@/shared/lib/cn';
import { Skeleton, SkeletonGroup } from '@/shared/ui/skeleton';
import { DateFact, RatingDots, ReviewSteps, STATUS_STYLE, ScoreBar, StatusPill } from './ui';

type Part = NonNullable<ReviewDetail['self']>;

function ReadPart({ part, competencies }: { part: Part; competencies: Competency[] }) {
  const { t } = useTranslation('reviews');
  const byId = new Map(part.ratings.map((r) => [r.competencyId, r]));
  return (
    <div className="space-y-4">
      <ul className="grid gap-3 sm:grid-cols-2">
        {competencies.map((c) => {
          const r = byId.get(c.id);
          return (
            <li key={c.id} className="space-y-2 rounded-lg border border-border bg-surface p-3">
              <p className="break-words font-medium">{c.name}</p>
              <ScoreBar score={r?.score ?? null} />
              {r?.comment && (
                <p className="whitespace-pre-line break-words border-l-2 border-border pl-2 text-sm text-muted-foreground">
                  {r.comment}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {part.summary && (
        <div className="space-y-1 rounded-lg bg-secondary p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('summary.heading')}
          </p>
          <p className="whitespace-pre-line break-words text-sm">{part.summary}</p>
        </div>
      )}
    </div>
  );
}

/** A part (self or manager) as a card: icon, heading, its state in words, then the content. */
function PartCard({
  icon: Icon,
  heading,
  state,
  children,
}: {
  icon: typeof UserPen;
  heading: string;
  state: { text: string; tone: 'done' | 'open' | 'muted' };
  children: ReactNode;
}) {
  return (
    <section aria-label={heading} className="space-y-4 rounded-xl glass p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
          {heading}
        </h2>
        <span
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-xs font-medium',
            state.tone === 'done' && 'border-success text-success',
            state.tone === 'open' && 'border-info text-info',
            state.tone === 'muted' && 'border-border text-muted-foreground',
          )}
        >
          {state.text}
        </span>
      </div>
      {children}
    </section>
  );
}

function Calibration({ review }: { review: ReviewDetail }) {
  const { t } = useTranslation('reviews');
  const errors = useReviewErrors();
  const calibrate = useCalibrate(review.id);
  const [rating, setRating] = useState(
    review.calibratedRating === null ? '' : String(review.calibratedRating),
  );
  return (
    <Card className="space-y-3">
      <h2 className="text-base font-semibold">{t('calibration.heading')}</h2>
      <p className="text-sm text-muted-foreground">
        {t('calibration.managerRating', { rating: review.manager?.overallRating ?? '—' })}
      </p>
      {review.canCalibrate ? (
        <form
          noValidate
          aria-label={t('calibration.heading')}
          className="space-y-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            calibrate.mutate(rating === '' ? null : Number(rating));
          }}
        >
          <Field label={t('calibration.rating')} hint={t('calibration.hint')}>
            {(field) => (
              <ScoreSelect
                {...field}
                emptyLabel={t('calibration.none')}
                value={rating}
                onChange={(e) => setRating(e.target.value)}
              />
            )}
          </Field>
          {calibrate.isError && <Alert tone="danger">{errors.apiError(calibrate.error)}</Alert>}
          <Button type="submit" disabled={calibrate.isPending}>
            {t('calibration.save')}
          </Button>
        </form>
      ) : (
        <p className="text-sm">
          {t('calibration.current', { rating: review.calibratedRating ?? '—' })}
        </p>
      )}
    </Card>
  );
}

export function ReviewDetailPage() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation('reviews');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useReviewErrors();
  const query = useReview(id);
  const reopen = useReopen(id);
  const review = query.data;

  if (query.isPending) {
    return (
      <SkeletonGroup label={t('loading')} className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </SkeletonGroup>
    );
  }
  if (query.isError || !review) {
    return (
      <Card className="mx-auto max-w-3xl space-y-3 text-center">
        <Alert tone="danger">
          {isApiError(query.error, 'NOT_FOUND') ? t('notFound') : errors.apiError(query.error)}
        </Alert>
        <BackLink to="/reviews" className="self-center">
          {t('back')}
        </BackLink>
      </Card>
    );
  }
  const name = `${review.employee.firstName} ${review.employee.lastName}`;
  const competencies = review.cycleDetail.competencies;
  // Only the employee gets `null` here: the state of the manager part is not theirs to know before release.
  const awaitingRelease = review.managerSubmitted === null;

  const partState = (part: Part | null, hidden = false) =>
    hidden
      ? { text: t('part.hidden'), tone: 'muted' as const }
      : part?.submittedAt
        ? {
            text: t('part.submitted', {
              date: formatDate(part.submittedAt, language, { dateStyle: 'medium' }),
            }),
            tone: 'done' as const,
          }
        : { text: t('part.notSubmitted'), tone: 'open' as const };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <BackLink to="/reviews">{t('back')}</BackLink>
      <section
        aria-label={t('detail.title', { name, cycle: review.cycle.name })}
        className="relative overflow-hidden rounded-xl glass p-4 pl-5 sm:p-6 sm:pl-7"
      >
        <span
          aria-hidden="true"
          className={cn('absolute inset-y-0 left-0 w-1.5', STATUS_STYLE[review.cycle.status].edge)}
        />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex items-start gap-3">
              <EmployeeAvatar
                firstName={review.employee.firstName}
                lastName={review.employee.lastName}
                className="size-14 text-lg"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <StatusPill status={review.cycle.status} />
                <h1 className="break-words text-2xl font-semibold">
                  {t('detail.title', { name, cycle: review.cycle.name })}
                </h1>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <DateFact icon={CalendarRange}>
                {t('detail.period', {
                  from: formatDay(review.cycleDetail.periodStart, language),
                  to: formatDay(review.cycleDetail.periodEnd, language),
                })}
              </DateFact>
              <DateFact icon={UserPen}>
                {t('detail.selfDue', { date: formatDay(review.cycleDetail.selfDue, language) })}
              </DateFact>
              <DateFact icon={UsersRound}>
                {t('detail.managerDue', {
                  date: formatDay(review.cycleDetail.managerDue, language),
                })}
              </DateFact>
            </div>
            <ReviewSteps review={review} />
          </div>
          <div className="flex shrink-0 flex-col items-center justify-center gap-2 rounded-xl bg-secondary p-4 text-center lg:w-56">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('detail.finalLabel')}
            </p>
            {review.finalRating !== null ? (
              <>
                <p className="text-4xl font-bold tabular-nums">
                  {review.finalRating}
                  <span className="text-base font-medium text-muted-foreground">/5</span>
                </p>
                <RatingDots rating={review.finalRating} />
                <p className="text-sm font-medium">
                  {t('detail.final', {
                    rating: review.finalRating,
                    words: t(`score.${String(review.finalRating) as '1'}`),
                  })}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('card.noFinal')}</p>
            )}
          </div>
        </div>
      </section>

      <PartCard icon={UserPen} heading={t('self.heading')} state={partState(review.self)}>
        {review.canWriteSelf ? (
          <PartEditor
            key={JSON.stringify(review.self)}
            reviewId={review.id}
            kind="self"
            competencies={competencies}
            initial={valuesOfPart(review.self)}
          />
        ) : review.self ? (
          <ReadPart part={review.self} competencies={competencies} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('self.notSubmitted')}</p>
        )}
      </PartCard>

      <PartCard
        icon={UsersRound}
        heading={t('manager.heading')}
        state={partState(review.manager, awaitingRelease && !review.manager)}
      >
        {review.canWriteManager ? (
          <PartEditor
            key={JSON.stringify(review.manager)}
            reviewId={review.id}
            kind="manager"
            competencies={competencies}
            initial={valuesOfPart(review.manager, review.manager?.overallRating ?? null)}
          />
        ) : review.manager ? (
          <>
            <ReadPart part={review.manager} competencies={competencies} />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                {t('manager.overallIs', { rating: review.manager.overallRating ?? '—' })}
                {review.manager.overallRating !== null && (
                  <RatingDots rating={review.manager.overallRating} />
                )}
              </p>
              {review.manager.author && (
                <p className="text-xs text-muted-foreground">
                  {t('manager.author', {
                    name: `${review.manager.author.firstName} ${review.manager.author.lastName}`,
                  })}
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {awaitingRelease ? t('manager.afterRelease') : t('manager.notSubmitted')}
          </p>
        )}
      </PartCard>

      {(review.canCalibrate || review.calibratedRating !== null) && <Calibration review={review} />}

      {review.canReopen && (
        <Card className="space-y-2">
          <h2 className="text-base font-semibold">{t('reopen.heading')}</h2>
          {reopen.isError && <Alert tone="danger">{errors.apiError(reopen.error)}</Alert>}
          <div className="flex flex-wrap gap-2">
            {review.self?.submittedAt && (
              <Button
                variant="secondary"
                disabled={reopen.isPending}
                onClick={() => reopen.mutate('self')}
              >
                {t('reopen.self')}
              </Button>
            )}
            {review.manager?.submittedAt && (
              <Button
                variant="secondary"
                disabled={reopen.isPending}
                onClick={() => reopen.mutate('manager')}
              >
                {t('reopen.manager')}
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
