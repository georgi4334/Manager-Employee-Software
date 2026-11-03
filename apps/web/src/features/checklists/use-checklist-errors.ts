import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';

/** API errors for the checklist screens: a second open checklist, a cancelled one or a limit say so. */
export function useChecklistErrors() {
  const { t } = useTranslation('checklists');
  const messages = useMessages();
  return {
    apiError(error: unknown): string {
      if (isApiError(error, 'CONFLICT')) {
        const field = error.params?.field;
        if (field === 'open' || field === 'status' || field === 'limit') return t(`rule.${field}`);
      }
      if (
        isApiError(error, 'VALIDATION_FAILED') &&
        error.details?.some((d) => d.code === 'unknown_employee')
      ) {
        return t('rule.unknown_employee');
      }
      return messages.apiError(error);
    },
  };
}
