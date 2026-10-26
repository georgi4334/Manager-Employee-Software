import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';

const RULES = [
  'no_manager',
  'unknown_employee',
  'nonexistent_time',
  'not_participant',
  'too_many',
] as const;
type Rule = (typeof RULES)[number];

/** API errors for the 1:1 screens: a missing manager or a time that does not exist says what is wrong. */
export function useMeetingErrors() {
  const { t } = useTranslation('meetings');
  const messages = useMessages();
  return {
    apiError(error: unknown): string {
      if (isApiError(error, 'VALIDATION_FAILED')) {
        const rule = error.details
          ?.map((d) => d.code)
          .find((c): c is Rule => RULES.includes(c as Rule));
        if (rule) return t(`rule.${rule}`);
      }
      if (isApiError(error, 'CONFLICT') && error.params?.field === 'status') {
        return t('rule.cancelled');
      }
      return messages.apiError(error);
    },
  };
}
