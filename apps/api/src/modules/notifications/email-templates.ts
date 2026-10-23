import type { NotificationType } from '@intime/contracts';
import { EMAIL_LOCALES, type EmailLocale } from '../../infrastructure/mail/templates.js';

export interface NotificationEmailVars {
  workspace: string;
  /** Absolute link into the web app. */
  link: string;
}

interface Template {
  subject: (v: NotificationEmailVars) => string;
  text: (v: NotificationEmailVars) => string;
}

/**
 * Emails say THAT something happened and link to the app; they never carry the details (GDPR: email is not a
 * secure channel). Every type must have a template in every language: the compiler enforces it.
 */
const TEMPLATES: Record<EmailLocale, Record<NotificationType, Template>> = {
  en: {
    'account.roles_changed': {
      subject: (v) => `Your access in ${v.workspace} has changed`,
      text: (v) =>
        `Hello,\n\nan administrator has changed your roles in ${v.workspace} on InTime.\n\n` +
        `Open InTime to see what changed:\n${v.link}\n\n` +
        `If you did not expect this, please contact your administrator.`,
    },
  },
  de: {
    'account.roles_changed': {
      subject: (v) => `Ihre Berechtigungen in ${v.workspace} wurden geändert`,
      text: (v) =>
        `Hallo,\n\neine Administration hat Ihre Rollen in ${v.workspace} auf InTime geändert.\n\n` +
        `Öffnen Sie InTime, um die Änderung zu sehen:\n${v.link}\n\n` +
        `Falls Sie das nicht erwartet haben, wenden Sie sich bitte an Ihre Administration.`,
    },
  },
  bg: {
    'account.roles_changed': {
      subject: (v) => `Правата ви в ${v.workspace} бяха променени`,
      text: (v) =>
        `Здравейте,\n\nадминистратор промени ролите ви в ${v.workspace} в InTime.\n\n` +
        `Отворете InTime, за да видите промяната:\n${v.link}\n\n` +
        `Ако не очаквате това, свържете се с администратора си.`,
    },
  },
};

export function renderNotificationEmail(
  type: NotificationType,
  locale: EmailLocale,
  vars: NotificationEmailVars,
) {
  const template = TEMPLATES[locale][type];
  return { subject: template.subject(vars), text: template.text(vars) };
}

export { EMAIL_LOCALES, TEMPLATES as NOTIFICATION_EMAIL_TEMPLATES };
