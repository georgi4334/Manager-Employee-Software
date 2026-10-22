import 'i18next';
import type common from './locales/en/common.json';
import type dashboard from './locales/en/dashboard.json';
import type errors from './locales/en/errors.json';
import type nav from './locales/en/nav.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof common;
      nav: typeof nav;
      dashboard: typeof dashboard;
      errors: typeof errors;
    };
  }
}
