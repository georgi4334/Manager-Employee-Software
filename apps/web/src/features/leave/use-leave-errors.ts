import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';
import { formatNumber } from '@/shared/lib/format';

const CONFLICT_FIELDS = ['dates', 'status', 'name', 'in_use', 'date'] as const;
type ConflictField = (typeof CONFLICT_FIELDS)[number];

const num = (value: unknown): number => (typeof value === 'number' ? value : 0);

/** API errors for the leave screens: conflicts and balance problems say exactly what is wrong. */
export function useLeaveErrors() {
  const { t, i18n } = useTranslation('leave');
  const messages = useMessages();
  const language = i18n.resolvedLanguage ?? 'en';
  return {
    apiError(error: unknown): string {
      if (isApiError(error, 'CONFLICT')) {
        const field = error.params?.field;
        if (CONFLICT_FIELDS.includes(field as ConflictField))
          return t(`conflict.${field as ConflictField}`);
      }
      if (isApiError(error, 'INSUFFICIENT_BALANCE')) {
        return t('insufficient', {
          available: formatNumber(num(error.params?.available), language),
          requested: formatNumber(num(error.params?.requested), language),
          year: num(error.params?.year),
        });
      }
      return messages.apiError(error);
    },
  };
}
