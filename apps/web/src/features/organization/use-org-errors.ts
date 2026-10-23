import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';

const CONFLICT_FIELDS = ['name', 'in_use', 'status'] as const;
type ConflictField = (typeof CONFLICT_FIELDS)[number];

/** API errors for the organization screens: conflicts say what clashes. */
export function useOrgErrors() {
  const { t } = useTranslation('organization');
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
