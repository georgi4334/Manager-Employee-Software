import { useTranslation } from 'react-i18next';
import { isApiError } from '@/shared/api/api-error';
import { useMessages } from '@/features/auth/messages';

const CONFLICT_FIELDS = ['employeeNo', 'email', 'account', 'status'] as const;
type ConflictField = (typeof CONFLICT_FIELDS)[number];

/** API errors for the employee screens: conflicts name the field that clashes, the rest is generic. */
export function useEmployeeErrors() {
  const { t } = useTranslation('employees');
  const messages = useMessages();
  return {
    apiError(error: unknown): string {
      if (isApiError(error, 'CONFLICT')) {
        const field = error.params?.field;
        if (CONFLICT_FIELDS.includes(field as ConflictField)) {
          return t(`conflict.${field as ConflictField}`);
        }
      }
      return messages.apiError(error);
    },
  };
}
