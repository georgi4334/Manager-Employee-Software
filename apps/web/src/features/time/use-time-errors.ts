import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';

const CONFLICT_FIELDS = ['running', 'locked', 'status'] as const;
type ConflictField = (typeof CONFLICT_FIELDS)[number];
const RULES = [
  'unknown_project',
  'not_on_project',
  'task_not_in_project',
  'project_closed',
  'future_date',
  'day_too_long',
  'not_a_monday',
  'future_week',
  'no_entries',
  'timer_running',
] as const;
type Rule = (typeof RULES)[number];

/** API errors for the time screens: a refused rule or a locked week says what is wrong. */
export function useTimeErrors() {
  const { t } = useTranslation('time');
  const messages = useMessages();
  return {
    apiError(error: unknown): string {
      if (isApiError(error, 'CONFLICT')) {
        const field = error.params?.field;
        if (CONFLICT_FIELDS.includes(field as ConflictField)) {
          return t(`conflict.${field as ConflictField}`);
        }
      }
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
