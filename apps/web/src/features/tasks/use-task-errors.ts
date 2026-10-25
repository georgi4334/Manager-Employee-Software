import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';

const RULES = ['unknown_employee', 'assignee_not_on_project', 'milestone_not_in_project'] as const;
type Rule = (typeof RULES)[number];

/** API errors for the task screens: a refused assignee or milestone says what is wrong. */
export function useTaskErrors() {
  const { t } = useTranslation('tasks');
  const messages = useMessages();
  return {
    apiError(error: unknown): string {
      if (isApiError(error, 'VALIDATION_FAILED')) {
        const rule = error.details
          ?.map((d) => d.code)
          .find((c): c is Rule => RULES.includes(c as Rule));
        if (rule) return t(`rule.${rule}`);
      }
      return messages.apiError(error);
    },
  };
}
