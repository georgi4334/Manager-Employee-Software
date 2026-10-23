import { useTranslation } from 'react-i18next';
import type { FieldError } from 'react-hook-form';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@intime/contracts';
import type errorsEn from '@/i18n/locales/en/errors.json';
import { isApiError, type ApiErrorCode } from '@/shared/api/api-error';

type ValidationKey = keyof typeof errorsEn.validation;
type ApiMessageKey = keyof typeof errorsEn.api;

// Compile-time guarantee: every error code the API client can produce has a translation.
type MissingTranslations = Exclude<ApiErrorCode, ApiMessageKey>;
const allCodesTranslated: [MissingTranslations] extends [never] ? true : never = true;
void allCodesTranslated;

const validationRules: Record<string, true> = {
  password_contains_email: true,
  password_too_repetitive: true,
  invalidDate: true,
  futureDate: true,
  invalidPhone: true,
  invalidCountry: true,
  terminationBeforeHire: true,
};

/** Translators for form validation errors and API errors, in the user's current language. */
export function useMessages() {
  const { t } = useTranslation('errors');

  return {
    validation(error: FieldError | undefined): string | undefined {
      if (!error?.message) return undefined;
      return t(`validation.${error.message as ValidationKey}`, {
        min: PASSWORD_MIN_LENGTH,
        max: PASSWORD_MAX_LENGTH,
      });
    },
    apiError(error: unknown): string {
      if (isApiError(error, 'VALIDATION_FAILED')) {
        // The API names the broken rule (e.g. password_contains_email); say exactly that when we can.
        const rule = error.details
          ?.map((d) => d.code)
          .find((code): code is ValidationKey => code in validationRules);
        if (rule)
          return t(`validation.${rule}`, { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH });
      }
      return t(`api.${isApiError(error) ? error.code : 'UNKNOWN'}`);
    },
    apiCode(code: ApiErrorCode): string {
      return t(`api.${code}`);
    },
  };
}
