import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';

const CONFLICT_FIELDS = ['code', 'name', 'overlap', 'client'] as const;
type ConflictField = (typeof CONFLICT_FIELDS)[number];
const RULES = ['unknown_client', 'unknown_employee'] as const;
type Rule = (typeof RULES)[number];

/** API errors for the project screens: a clash or an unknown reference says what is wrong. */
export function useProjectErrors() {
  const { t } = useTranslation('projects');
  const messages = useMessages();
  return {
    apiError(error: unknown): string {
      if (isApiError(error, 'CONFLICT')) {
        const field = error.params?.field;
        if (CONFLICT_FIELDS.includes(field as ConflictField))
          return t(`conflict.${field as ConflictField}`);
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
