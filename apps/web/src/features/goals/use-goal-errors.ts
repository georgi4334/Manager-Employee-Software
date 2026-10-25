import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';

const RULES = [
  'unknown_employee',
  'unknown_team',
  'parent_not_found',
  'parent_not_wider',
  'too_many',
  'same_as_start',
] as const;
type Rule = (typeof RULES)[number];

/** API errors for the goal screens: a refused owner, team or alignment says what is wrong. */
export function useGoalErrors() {
  const { t } = useTranslation('goals');
  const messages = useMessages();
  return {
    apiError(error: unknown): string {
      if (isApiError(error, 'VALIDATION_FAILED')) {
        const rule = error.details
          ?.map((d) => d.code)
          .find((c): c is Rule => RULES.includes(c as Rule));
        if (rule) return t(`rule.${rule}`);
      }
      if (isApiError(error, 'CONFLICT') && error.params?.field === 'children') {
        return t('rule.children');
      }
      return messages.apiError(error);
    },
  };
}
