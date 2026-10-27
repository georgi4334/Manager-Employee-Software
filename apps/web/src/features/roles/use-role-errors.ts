import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';

/** API errors of the role screens: name taken, role in use, limit reached, a permission one may not pass on. */
export function useRoleErrors() {
  const { t } = useTranslation('roles');
  const messages = useMessages();
  return {
    apiError(error: unknown): string {
      if (isApiError(error, 'CONFLICT')) {
        const field = error.params?.field;
        if (field === 'name') return t('errors.nameTaken');
        if (field === 'in_use') return t('errors.inUse');
        if (field === 'limit') return t('errors.limit');
      }
      if (isApiError(error, 'FORBIDDEN') && error.details?.some((d) => d.code === 'cannot_grant')) {
        return t('errors.cannotGrant');
      }
      return messages.apiError(error);
    },
  };
}
