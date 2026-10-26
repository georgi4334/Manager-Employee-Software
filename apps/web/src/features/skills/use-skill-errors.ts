import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';

const RULES = ['skill_archived', 'unknown_category'] as const;
type Rule = (typeof RULES)[number];

/** API errors for the skills screens: a duplicate name or a skill still in use says what is wrong. */
export function useSkillErrors() {
  const { t } = useTranslation('skills');
  const messages = useMessages();
  return {
    apiError(error: unknown): string {
      if (isApiError(error, 'VALIDATION_FAILED')) {
        const rule = error.details
          ?.map((d) => d.code)
          .find((c): c is Rule => RULES.includes(c as Rule));
        if (rule) return t(`rule.${rule}`);
      }
      if (isApiError(error, 'CONFLICT')) {
        if (error.params?.field === 'name') return t('rule.name');
        if (error.params?.field === 'in_use') return t('rule.in_use');
      }
      return messages.apiError(error);
    },
  };
}
