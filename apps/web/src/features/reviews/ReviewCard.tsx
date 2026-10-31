import type { ReviewSummary } from '@intime/contracts';
import { ClipboardCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { EmployeeAvatar } from '@/features/employees/EmployeeAvatar';
import { cn } from '@/shared/lib/cn';
import { Tile } from '@/shared/ui/tiles';
import { RatingDots, ReviewSteps, STATUS_STYLE, StatusPill } from './ui';

/**
 * One review in a list: who (or which cycle, for your own), the cycle stage, where the two parts stand and,
 * once there is one, the final rating. The whole card opens the review.
 */
export function ReviewCard({
  review,
  showEmployee,
}: {
  review: ReviewSummary;
  showEmployee: boolean;
}) {
  const { t } = useTranslation('reviews');
  const name = `${review.employee.firstName} ${review.employee.lastName}`;
  const title = showEmployee ? name : review.cycle.name;

  return (
    <li>
      <article
        aria-label={showEmployee ? t('card.of', { name, cycle: review.cycle.name }) : title}
        className="relative flex h-full flex-col gap-4 overflow-hidden rounded-xl glass glass-hover p-4 pl-5"
      >
        <span
          aria-hidden="true"
          className={cn('absolute inset-y-0 left-0 w-1.5', STATUS_STYLE[review.cycle.status].edge)}
        />
        <div className="flex items-start gap-3">
          {showEmployee ? (
            <EmployeeAvatar
              firstName={review.employee.firstName}
              lastName={review.employee.lastName}
              className="size-11"
            />
          ) : (
            <Tile>
              <ClipboardCheck className="size-5" />
            </Tile>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-base font-semibold leading-snug">
              {/* The stretched link makes the whole card open the review. */}
              <Link
                to={`/reviews/${review.id}`}
                aria-label={
                  showEmployee ? t('card.of', { name, cycle: review.cycle.name }) : undefined
                }
                className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-ring"
              >
                {title}
              </Link>
            </h2>
            <p className="text-sm text-muted-foreground">
              {showEmployee ? review.cycle.name : t('card.mine')}
            </p>
          </div>
          <StatusPill status={review.cycle.status} />
        </div>

        <ReviewSteps review={review} compact />

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          {review.finalRating !== null ? (
            <>
              <span className="text-sm font-medium">
                {t('card.final', { rating: review.finalRating })}
              </span>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <RatingDots rating={review.finalRating} />
                {t(`score.${String(review.finalRating) as '1'}`)}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">{t('card.noFinal')}</span>
          )}
        </div>
      </article>
    </li>
  );
}
