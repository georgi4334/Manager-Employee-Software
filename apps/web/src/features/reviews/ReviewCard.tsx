import type { ReviewSummary } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function ReviewCard({
  review,
  showEmployee,
}: {
  review: ReviewSummary;
  showEmployee: boolean;
}) {
  const { t } = useTranslation('reviews');
  const name = `${review.employee.firstName} ${review.employee.lastName}`;
  const part = (submitted: boolean | null, overdue: boolean | null) =>
    submitted === null
      ? t('state.unknown')
      : submitted
        ? t('state.submitted')
        : overdue
          ? t('state.overdue')
          : t('state.open');
  return (
    <li className="space-y-1 rounded-xl glass p-4">
      <Link to={`/reviews/${review.id}`} className="font-medium text-primary underline">
        {showEmployee ? t('card.of', { name, cycle: review.cycle.name }) : review.cycle.name}
      </Link>
      <p className="text-sm text-muted-foreground">
        {t(`status.${review.cycle.status}`)}
        {' · '}
        {t('card.self', { state: part(review.selfSubmitted, review.selfOverdue) })}
        {' · '}
        {t('card.manager', { state: part(review.managerSubmitted, review.managerOverdue) })}
      </p>
      {review.finalRating !== null && (
        <p className="text-sm">{t('card.final', { rating: review.finalRating })}</p>
      )}
    </li>
  );
}
