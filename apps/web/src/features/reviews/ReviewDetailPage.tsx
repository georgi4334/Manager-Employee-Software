import type { Competency, ReviewDetail } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { isApiError } from '@/shared/api/api-error';
import { formatDay } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { valuesOfPart } from './forms';
import { useCalibrate, useReopen, useReview } from './hooks';
import { PartEditor } from './PartEditor';
import { ScoreSelect } from './ScoreSelect';
import { useReviewErrors } from './use-review-errors';

type Part = NonNullable<ReviewDetail['self']>;

function ReadPart({
  part,
  competencies,
  heading,
}: {
  part: Part;
  competencies: Competency[];
  heading: string;
}) {
  const { t } = useTranslation('reviews');
  const byId = new Map(part.ratings.map((r) => [r.competencyId, r]));
  return (
    <section aria-label={heading} className="space-y-3">
      <h2 className="text-base font-semibold">{heading}</h2>
      <ul className="space-y-2">
        {competencies.map((c) => {
          const r = byId.get(c.id);
          return (
            <li key={c.id} className="rounded-lg border border-border p-3">
              <p className="font-medium">{c.name}</p>
              <p className="text-sm">
                {r ? `${r.score} · ${t(`score.${String(r.score) as '1'}`)}` : t('score.none')}
              </p>
              {r?.comment && (
                <p className="whitespace-pre-line break-words text-sm text-muted-foreground">
                  {r.comment}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {part.summary && <p className="whitespace-pre-line break-words text-sm">{part.summary}</p>}
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
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  }
  if (query.isError || !review) {
    return (
      <Card className="mx-auto max-w-3xl space-y-3 text-center">
        <Alert tone="danger">
          {isApiError(query.error, 'NOT_FOUND') ? t('notFound') : errors.apiError(query.error)}
        </Alert>
        <Link to="/reviews" className="text-primary underline">
          {t('back')}
        </Link>
      </Card>
    );
  }
  const name = `${review.employee.firstName} ${review.employee.lastName}`;
  const competencies = review.cycleDetail.competencies;
  // Only the employee gets `null` here: the state of the manager part is not theirs to know before release.
  const awaitingRelease = review.managerSubmitted === null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/reviews" className="text-sm text-primary underline">
        {t('back')}
      </Link>
      <Card className="space-y-2">
        <h1 className="break-words text-2xl font-semibold">
          {t('detail.title', { name, cycle: review.cycle.name })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(`status.${review.cycle.status}`)}
          {' · '}
          {t('detail.period', {
            from: formatDay(review.cycleDetail.periodStart, language),
            to: formatDay(review.cycleDetail.periodEnd, language),
          })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('detail.dues', {
            self: formatDay(review.cycleDetail.selfDue, language),
            manager: formatDay(review.cycleDetail.managerDue, language),
          })}
        </p>
        {review.finalRating !== null && (
          <p className="font-medium">
            {t('detail.final', {
              rating: review.finalRating,
              words: t(`score.${String(review.finalRating) as '1'}`),
            })}
          </p>
        )}
      </Card>

      <Card className="space-y-3">
        {review.canWriteSelf ? (
          <>
            <h2 className="text-base font-semibold">{t('self.heading')}</h2>
            <PartEditor
              key={JSON.stringify(review.self)}
              reviewId={review.id}
              kind="self"
              competencies={competencies}
              initial={valuesOfPart(review.self)}
            />
          </>
        ) : review.self ? (
          <ReadPart part={review.self} competencies={competencies} heading={t('self.heading')} />
        ) : (
          <>
            <h2 className="text-base font-semibold">{t('self.heading')}</h2>
            <p className="text-sm text-muted-foreground">{t('self.notSubmitted')}</p>
          </>
        )}
      </Card>

      <Card className="space-y-3">
        {review.canWriteManager ? (
          <>
            <h2 className="text-base font-semibold">{t('manager.heading')}</h2>
            <PartEditor
              key={JSON.stringify(review.manager)}
              reviewId={review.id}
              kind="manager"
              competencies={competencies}
              initial={valuesOfPart(review.manager, review.manager?.overallRating ?? null)}
            />
          </>
        ) : review.manager ? (
          <>
            <ReadPart
              part={review.manager}
              competencies={competencies}
              heading={t('manager.heading')}
            />
            <p className="text-sm font-medium">
              {t('manager.overallIs', { rating: review.manager.overallRating ?? '—' })}
            </p>
            {review.manager.author && (
              <p className="text-xs text-muted-foreground">
                {t('manager.author', {
                  name: `${review.manager.author.firstName} ${review.manager.author.lastName}`,
                })}
              </p>
            )}
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold">{t('manager.heading')}</h2>
            <p className="text-sm text-muted-foreground">
              {awaitingRelease ? t('manager.afterRelease') : t('manager.notSubmitted')}
            </p>
          </>
        )}
      </Card>

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
