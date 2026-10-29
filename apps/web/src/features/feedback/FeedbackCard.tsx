import type { FeedbackItem } from '@intime/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { useKeepFeedback, useRemoveFeedback, useReportFeedback } from './hooks';
import { useFeedbackErrors } from './use-feedback-errors';

export function FeedbackCard({ item }: { item: FeedbackItem }) {
  const { t, i18n } = useTranslation('feedback');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useFeedbackErrors();
  const remove = useRemoveFeedback();
  const report = useReportFeedback();
  const keep = useKeepFeedback();
  const [confirming, setConfirming] = useState(false);
  const error = remove.error ?? report.error ?? keep.error;
  const from = `${item.from.firstName} ${item.from.lastName}`;
  const to = `${item.to.firstName} ${item.to.lastName}`;

  return (
    <li className="space-y-2 rounded-xl glass p-4">
      <p className="text-sm text-muted-foreground">
        {t('card.fromTo', { from, to })}
        {' · '}
        {t(`kind.${item.kind}`)}
        {' · '}
        {t(`visibility.${item.visibility}`)}
        {' · '}
        {formatDate(item.createdAt, language, { dateStyle: 'medium' })}
      </p>
      <p className="whitespace-pre-line break-words">{item.body}</p>
      {item.report === 'open' && <p className="text-sm text-warning">{t('card.reported')}</p>}
      {item.report === 'kept' && <p className="text-sm text-muted-foreground">{t('card.kept')}</p>}
      {error && <Alert tone="danger">{errors.apiError(error)}</Alert>}
      <div className="flex flex-wrap gap-2">
        {item.canReport && (
          <Button
            variant="secondary"
            disabled={report.isPending}
            onClick={() => report.mutate(item.id)}
          >
            {t('card.report')}
          </Button>
        )}
        {item.canKeep && (
          <Button
            variant="secondary"
            disabled={keep.isPending}
            onClick={() => keep.mutate(item.id)}
          >
            {t('card.keep')}
          </Button>
        )}
        {item.canRemove &&
          (confirming ? (
            <>
              <Button disabled={remove.isPending} onClick={() => remove.mutate(item.id)}>
                {t('card.confirmRemove')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t('card.cancel')}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              {t('card.remove')}
            </Button>
          ))}
      </div>
    </li>
  );
}
