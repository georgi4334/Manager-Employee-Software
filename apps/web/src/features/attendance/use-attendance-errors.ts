import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';

const CONFLICT_FIELDS = ['open', 'overlap'] as const;
type ConflictField = (typeof CONFLICT_FIELDS)[number];
const RULES = [
  'in_future',
  'before_check_in',
  'too_long',
  'nonexistent_time',
  'open_record',
  'too_far_in_past',
] as const;
type Rule = (typeof RULES)[number];

/** API errors for the attendance screens: they say which rule was broken. */
export function useAttendanceErrors() {
  const { t } = useTranslation('attendance');
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
