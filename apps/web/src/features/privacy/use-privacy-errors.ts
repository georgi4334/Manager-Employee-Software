import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';

const CONFLICT_FIELDS = ['active', 'self', 'erased'] as const;
type ConflictField = (typeof CONFLICT_FIELDS)[number];

/** API errors for the privacy screens: a refused erasure says which rule applies. */
export function usePrivacyErrors() {
  const { t } = useTranslation('privacy');
  const messages = useMessages();
  return {
    apiError(error: unknown): string {
      if (isApiError(error, 'CONFLICT')) {
        const field = error.params?.field;
        if (CONFLICT_FIELDS.includes(field as ConflictField))
          return t(`conflict.${field as ConflictField}`);
      }
      return messages.apiError(error);
    },
  };
}
