import 'i18next';
import type auth from './locales/en/auth.json';
import type common from './locales/en/common.json';
import type dashboard from './locales/en/dashboard.json';
import type errors from './locales/en/errors.json';
import type nav from './locales/en/nav.json';
import type employees from './locales/en/employees.json';
import type organization from './locales/en/organization.json';
import type leave from './locales/en/leave.json';
import type attendance from './locales/en/attendance.json';
import type calendar from './locales/en/calendar.json';
import type privacy from './locales/en/privacy.json';
import type projects from './locales/en/projects.json';
import type tasks from './locales/en/tasks.json';
import type time from './locales/en/time.json';
import type capacity from './locales/en/capacity.json';
import type goals from './locales/en/goals.json';
import type meetings from './locales/en/meetings.json';
import type feedback from './locales/en/feedback.json';
import type skills from './locales/en/skills.json';
import type reviews from './locales/en/reviews.json';
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
      attendance: typeof attendance;
      calendar: typeof calendar;
      privacy: typeof privacy;
      projects: typeof projects;
      tasks: typeof tasks;
      time: typeof time;
      capacity: typeof capacity;
      goals: typeof goals;
      meetings: typeof meetings;
      feedback: typeof feedback;
      skills: typeof skills;
      reviews: typeof reviews;
    };
  }
}
