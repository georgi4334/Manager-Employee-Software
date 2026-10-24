import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';

/** API errors for the calendar screens: a time lost to the clock change says exactly that. */
export function useCalendarErrors() {
  const { t } = useTranslation('calendar');
  const messages = useMessages();
  return {
    apiError(error: unknown): string {
      if (
        isApiError(error, 'VALIDATION_FAILED') &&
        error.details?.some((d) => d.code === 'nonexistent_time')
      ) {
        return t('rule.nonexistent_time');
      }
      return messages.apiError(error);
    },
  };
}
