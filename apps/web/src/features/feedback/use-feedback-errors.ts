import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';

const RULES = ['self', 'unknown_employee'] as const;
type Rule = (typeof RULES)[number];

/** API errors for the feedback screens: a refused recipient or a second report says what is wrong. */
export function useFeedbackErrors() {
  const { t } = useTranslation('feedback');
  const messages = useMessages();
  return {
    apiError(error: unknown): string {
      if (isApiError(error, 'VALIDATION_FAILED')) {
        const rule = error.details
          ?.map((d) => d.code)
          .find((c): c is Rule => RULES.includes(c as Rule));
        if (rule) return t(`rule.${rule}`);
      }
      if (isApiError(error, 'CONFLICT') && error.params?.field === 'report') {
        return t('rule.reported');
      }
      return messages.apiError(error);
    },
  };
}
