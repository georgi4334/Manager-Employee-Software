import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';

const RULES = [
  'incomplete',
  'required',
  'unknown_competency',
  'no_competencies',
  'too_many',
  'end_before_start',
  'unknown_cycle',
] as const;
type Rule = (typeof RULES)[number];

/** API errors for the review screens: an incomplete submit or a locked part says what is wrong. */
export function useReviewErrors() {
  const { t } = useTranslation('reviews');
  const messages = useMessages();
  return {
    apiError(error: unknown): string {
      if (isApiError(error, 'VALIDATION_FAILED')) {
        const rule = error.details
          ?.map((d) => d.code)
          .find((c): c is Rule => RULES.includes(c as Rule));
        if (rule) return t(`rule.${rule}`);
      }
      if (isApiError(error, 'CONFLICT')) {
        const field = error.params?.field;
        if (field === 'status') return t('rule.status');
        if (field === 'submitted') return t('rule.submitted');
        if (field === 'name') return t('rule.name');
      }
      return messages.apiError(error);
    },
  };
}
