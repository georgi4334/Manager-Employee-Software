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
    'leave.requested': {
      subject: (v) => `A leave request in ${v.workspace} needs your attention`,
      text: (v) =>
        `Hello,\n\nthere is a new leave request in ${v.workspace} on InTime.\n\n` +
        `Open InTime to review it:\n${v.link}`,
    },
    'leave.decided': {
      subject: (v) => `Your leave request in ${v.workspace} has been decided`,
      text: (v) =>
        `Hello,\n\nyour leave request in ${v.workspace} on InTime has been decided.\n\n` +
        `Open InTime to see the result:\n${v.link}`,
    },
    'leave.cancelled': {
      subject: (v) => `A leave request in ${v.workspace} has been cancelled`,
      text: (v) =>
        `Hello,\n\na leave request in ${v.workspace} on InTime has been cancelled.\n\n` +
        `Open InTime for details:\n${v.link}`,
    },
    'attendance.corrected': {
      subject: (v) => `One of your attendance records in ${v.workspace} was changed`,
      text: (v) =>
        `Hello,\n\nsomebody changed one of your attendance records in ${v.workspace} on InTime.\n\n` +
        `Open InTime to see it:\n${v.link}`,
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
    'leave.requested': {
      subject: (v) => `Ein Urlaubsantrag in ${v.workspace} wartet auf Sie`,
      text: (v) =>
        `Hallo,\n\nes gibt einen neuen Urlaubsantrag in ${v.workspace} auf InTime.\n\n` +
        `Öffnen Sie InTime, um ihn zu prüfen:\n${v.link}`,
    },
    'leave.decided': {
      subject: (v) => `Über Ihren Urlaubsantrag in ${v.workspace} wurde entschieden`,
      text: (v) =>
        `Hallo,\n\nüber Ihren Urlaubsantrag in ${v.workspace} auf InTime wurde entschieden.\n\n` +
        `Öffnen Sie InTime, um das Ergebnis zu sehen:\n${v.link}`,
    },
    'leave.cancelled': {
      subject: (v) => `Ein Urlaubsantrag in ${v.workspace} wurde storniert`,
      text: (v) =>
        `Hallo,\n\nein Urlaubsantrag in ${v.workspace} auf InTime wurde storniert.\n\n` +
        `Öffnen Sie InTime für Details:\n${v.link}`,
    },
    'attendance.corrected': {
      subject: (v) => `Einer Ihrer Anwesenheitseinträge in ${v.workspace} wurde geändert`,
      text: (v) =>
        `Hallo,\n\njemand hat einen Ihrer Anwesenheitseinträge in ${v.workspace} auf InTime geändert.\n\n` +
        `Öffnen Sie InTime, um ihn zu sehen:\n${v.link}`,
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
    'leave.requested': {
      subject: (v) => `Заявка за отпуск в ${v.workspace} очаква вашето внимание`,
      text: (v) =>
        `Здравейте,\n\nима нова заявка за отпуск в ${v.workspace} в InTime.\n\n` +
        `Отворете InTime, за да я прегледате:\n${v.link}`,
    },
    'leave.decided': {
      subject: (v) => `По вашата заявка за отпуск в ${v.workspace} има решение`,
      text: (v) =>
        `Здравейте,\n\nпо вашата заявка за отпуск в ${v.workspace} в InTime има решение.\n\n` +
        `Отворете InTime, за да видите резултата:\n${v.link}`,
    },
    'leave.cancelled': {
      subject: (v) => `Заявка за отпуск в ${v.workspace} беше отказана`,
      text: (v) =>
        `Здравейте,\n\nзаявка за отпуск в ${v.workspace} в InTime беше отказана.\n\n` +
        `Отворете InTime за подробности:\n${v.link}`,
    },
    'attendance.corrected': {
      subject: (v) => `Един от записите ви за присъствие в ${v.workspace} беше променен`,
      text: (v) =>
        `Здравейте,\n\nнякой промени един от записите ви за присъствие в ${v.workspace} в InTime.\n\n` +
        `Отворете InTime, за да го видите:\n${v.link}`,
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
