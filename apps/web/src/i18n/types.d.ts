import 'i18next';
import type auth from './locales/en/auth.json';
import type common from './locales/en/common.json';
import type dashboard from './locales/en/dashboard.json';
import type errors from './locales/en/errors.json';
import type nav from './locales/en/nav.json';
import type employees from './locales/en/employees.json';
import type organization from './locales/en/organization.json';
import type leave from './locales/en/leave.json';
import type notifications from './locales/en/notifications.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof common;
      nav: typeof nav;
      dashboard: typeof dashboard;
      errors: typeof errors;
      auth: typeof auth;
      notifications: typeof notifications;
      employees: typeof employees;
      organization: typeof organization;
      leave: typeof leave;
    };
  }
}
