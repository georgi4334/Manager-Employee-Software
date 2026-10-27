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
    'project.assigned': {
      subject: (v) => `You were added to a project in ${v.workspace}`,
      text: (v) =>
        `Hello,\n\nyou were added to a project in ${v.workspace} on InTime.\n\n` +
        `Open InTime to see it:\n${v.link}`,
    },
    'task.assigned': {
      subject: (v) => `A task was assigned to you in ${v.workspace}`,
      text: (v) =>
        `Hello,\n\na task was assigned to you in ${v.workspace} on InTime.\n\n` +
        `Open InTime to see it:\n${v.link}`,
    },
    'one_on_one.changed': {
      subject: (v) => `A 1:1 meeting in ${v.workspace} changed`,
      text: (v) =>
        `Hello,\n\na 1:1 meeting with you in ${v.workspace} on InTime was scheduled, moved or cancelled.\n\n` +
        `Open InTime to see it:\n${v.link}`,
    },
    'feedback.received': {
      subject: (v) => `You received feedback in ${v.workspace}`,
      text: (v) =>
        `Hello,\n\nsomebody gave you feedback in ${v.workspace} on InTime.\n\n` +
        `Open InTime to read it:\n${v.link}`,
    },
    'review.cycle_opened': {
      subject: (v) => `A performance review cycle opened in ${v.workspace}`,
      text: (v) =>
        `Hello,\n\na performance review cycle opened in ${v.workspace} on InTime. Your review is waiting.\n\n` +
        `Open InTime to start:\n${v.link}`,
    },
    'review.released': {
      subject: (v) => `Your performance review is ready in ${v.workspace}`,
      text: (v) =>
        `Hello,\n\nyour performance review in ${v.workspace} on InTime was released.\n\n` +
        `Open InTime to read it:\n${v.link}`,
    },
    'calendar.invited': {
      subject: (v) => `You were invited to an event in ${v.workspace}`,
      text: (v) =>
        `Hello,\n\nyou were invited to an event in ${v.workspace} on InTime.\n\n` +
        `Open InTime to answer:\n${v.link}`,
    },
    'calendar.response': {
      subject: (v) => `A guest answered your event in ${v.workspace}`,
      text: (v) =>
        `Hello,\n\na guest answered an event of yours in ${v.workspace} on InTime.\n\n` +
        `Open InTime to see it:\n${v.link}`,
    },
    'calendar.changed': {
      subject: (v) => `An event in ${v.workspace} changed`,
      text: (v) =>
        `Hello,\n\nan event you were invited to in ${v.workspace} on InTime was changed or cancelled.\n\n` +
        `Open InTime to see it:\n${v.link}`,
    },
    'goal.assigned': {
      subject: (v) => `A goal was set for you in ${v.workspace}`,
      text: (v) =>
        `Hello,\n\na goal was set for you in ${v.workspace} on InTime.\n\n` +
        `Open InTime to see it:\n${v.link}`,
    },
    'attendance.reminder': {
      subject: (v) => `A check-in in ${v.workspace} is still open`,
      text: (v) =>
        `Hello,\n\nyou have a check-in in ${v.workspace} on InTime that was never closed.\n\n` +
        `Open InTime to check out or correct it:\n${v.link}`,
    },
    'time.timer_reminder': {
      subject: (v) => `Your timer in ${v.workspace} is still running`,
      text: (v) =>
        `Hello,\n\na timer is still running for you in ${v.workspace} on InTime.\n\n` +
        `Open InTime to stop it:\n${v.link}`,
    },
    'timesheet.decided': {
      subject: (v) => `A decision on your timesheet in ${v.workspace}`,
      text: (v) =>
        `Hello,\n\nthere is a decision on your timesheet in ${v.workspace} on InTime.\n\n` +
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
    'project.assigned': {
      subject: (v) => `Sie wurden in ${v.workspace} einem Projekt zugeordnet`,
      text: (v) =>
        `Hallo,\n\nSie wurden in ${v.workspace} auf InTime einem Projekt zugeordnet.\n\n` +
        `Öffnen Sie InTime, um es zu sehen:\n${v.link}`,
    },
    'task.assigned': {
      subject: (v) => `Ihnen wurde in ${v.workspace} eine Aufgabe zugewiesen`,
      text: (v) =>
        `Hallo,\n\nIhnen wurde in ${v.workspace} auf InTime eine Aufgabe zugewiesen.\n\n` +
        `Öffnen Sie InTime, um sie zu sehen:\n${v.link}`,
    },
    'one_on_one.changed': {
      subject: (v) => `Ein 1:1-Gespräch in ${v.workspace} wurde geändert`,
      text: (v) =>
        `Hallo,\n\nein 1:1-Gespräch mit Ihnen wurde in ${v.workspace} auf InTime angesetzt, verschoben oder abgesagt.\n\n` +
        `Öffnen Sie InTime, um es zu sehen:\n${v.link}`,
    },
    'feedback.received': {
      subject: (v) => `Sie haben in ${v.workspace} Feedback erhalten`,
      text: (v) =>
        `Hallo,\n\njemand hat Ihnen in ${v.workspace} auf InTime Feedback gegeben.\n\n` +
        `Öffnen Sie InTime, um es zu lesen:\n${v.link}`,
    },
    'review.cycle_opened': {
      subject: (v) => `In ${v.workspace} hat eine Beurteilungsrunde begonnen`,
      text: (v) =>
        `Hallo,\n\nin ${v.workspace} auf InTime hat eine Beurteilungsrunde begonnen. Ihre Beurteilung wartet.\n\n` +
        `Öffnen Sie InTime, um zu beginnen:\n${v.link}`,
    },
    'review.released': {
      subject: (v) => `Ihre Beurteilung in ${v.workspace} ist bereit`,
      text: (v) =>
        `Hallo,\n\nIhre Beurteilung in ${v.workspace} auf InTime wurde freigegeben.\n\n` +
        `Öffnen Sie InTime, um sie zu lesen:\n${v.link}`,
    },
    'calendar.invited': {
      subject: (v) => `Sie wurden in ${v.workspace} zu einem Termin eingeladen`,
      text: (v) =>
        `Hallo,\n\nSie wurden in ${v.workspace} auf InTime zu einem Termin eingeladen.\n\n` +
        `Öffnen Sie InTime, um zu antworten:\n${v.link}`,
    },
    'calendar.response': {
      subject: (v) => `Eine Antwort auf Ihren Termin in ${v.workspace}`,
      text: (v) =>
        `Hallo,\n\neine eingeladene Person hat auf einen Ihrer Termine in ${v.workspace} auf InTime geantwortet.\n\n` +
        `Öffnen Sie InTime, um es zu sehen:\n${v.link}`,
    },
    'calendar.changed': {
      subject: (v) => `Ein Termin in ${v.workspace} wurde geändert`,
      text: (v) =>
        `Hallo,\n\nein Termin, zu dem Sie in ${v.workspace} auf InTime eingeladen wurden, wurde geändert oder abgesagt.\n\n` +
        `Öffnen Sie InTime, um es zu sehen:\n${v.link}`,
    },
    'goal.assigned': {
      subject: (v) => `Für Sie wurde in ${v.workspace} ein Ziel gesetzt`,
      text: (v) =>
        `Hallo,\n\nfür Sie wurde in ${v.workspace} auf InTime ein Ziel gesetzt.\n\n` +
        `Öffnen Sie InTime, um es zu sehen:\n${v.link}`,
    },
    'attendance.reminder': {
      subject: (v) => `Eine Anmeldung in ${v.workspace} ist noch offen`,
      text: (v) =>
        `Hallo,\n\nSie haben in ${v.workspace} auf InTime eine Anmeldung, die nie beendet wurde.\n\n` +
        `Öffnen Sie InTime, um sich abzumelden oder sie zu korrigieren:\n${v.link}`,
    },
    'time.timer_reminder': {
      subject: (v) => `Ihr Timer in ${v.workspace} läuft noch`,
      text: (v) =>
        `Hallo,\n\nfür Sie läuft in ${v.workspace} auf InTime noch ein Timer.\n\n` +
        `Öffnen Sie InTime, um ihn zu stoppen:\n${v.link}`,
    },
    'timesheet.decided': {
      subject: (v) => `Entscheidung zu Ihrem Zeitnachweis in ${v.workspace}`,
      text: (v) =>
        `Hallo,\n\nzu Ihrem Zeitnachweis in ${v.workspace} auf InTime gibt es eine Entscheidung.\n\n` +
        `Öffnen Sie InTime, um sie zu sehen:\n${v.link}`,
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
    'project.assigned': {
      subject: (v) => `Добавени сте към проект в ${v.workspace}`,
      text: (v) =>
        `Здравейте,\n\nдобавени сте към проект в ${v.workspace} в InTime.\n\n` +
        `Отворете InTime, за да го видите:\n${v.link}`,
    },
    'task.assigned': {
      subject: (v) => `Възложена ви е задача в ${v.workspace}`,
      text: (v) =>
        `Здравейте,\n\nвъзложена ви е задача в ${v.workspace} в InTime.\n\n` +
        `Отворете InTime, за да я видите:\n${v.link}`,
    },
    'one_on_one.changed': {
      subject: (v) => `Среща 1:1 в ${v.workspace} беше променена`,
      text: (v) =>
        `Здравейте,\n\nсреща 1:1 с вас беше насрочена, преместена или отменена в ${v.workspace} в InTime.\n\n` +
        `Отворете InTime, за да я видите:\n${v.link}`,
    },
    'feedback.received': {
      subject: (v) => `Получихте обратна връзка в ${v.workspace}`,
      text: (v) =>
        `Здравейте,\n\nнякой ви даде обратна връзка в ${v.workspace} в InTime.\n\n` +
        `Отворете InTime, за да я прочетете:\n${v.link}`,
    },
    'review.cycle_opened': {
      subject: (v) => `В ${v.workspace} започна цикъл на оценяване`,
      text: (v) =>
        `Здравейте,\n\nв ${v.workspace} в InTime започна цикъл на оценяване. Вашата оценка ви чака.\n\n` +
        `Отворете InTime, за да започнете:\n${v.link}`,
    },
    'review.released': {
      subject: (v) => `Вашата оценка в ${v.workspace} е готова`,
      text: (v) =>
        `Здравейте,\n\nвашата оценка в ${v.workspace} в InTime беше публикувана.\n\n` +
        `Отворете InTime, за да я прочетете:\n${v.link}`,
    },
    'calendar.invited': {
      subject: (v) => `Поканени сте на събитие в ${v.workspace}`,
      text: (v) =>
        `Здравейте,\n\nпоканени сте на събитие в ${v.workspace} в InTime.\n\n` +
        `Отворете InTime, за да отговорите:\n${v.link}`,
    },
    'calendar.response': {
      subject: (v) => `Отговор на ваше събитие в ${v.workspace}`,
      text: (v) =>
        `Здравейте,\n\nпоканен гост отговори на ваше събитие в ${v.workspace} в InTime.\n\n` +
        `Отворете InTime, за да го видите:\n${v.link}`,
    },
    'calendar.changed': {
      subject: (v) => `Събитие в ${v.workspace} беше променено`,
      text: (v) =>
        `Здравейте,\n\nсъбитие, на което сте поканени в ${v.workspace} в InTime, беше променено или отменено.\n\n` +
        `Отворете InTime, за да го видите:\n${v.link}`,
    },
    'goal.assigned': {
      subject: (v) => `Зададена ви е цел в ${v.workspace}`,
      text: (v) =>
        `Здравейте,\n\nзададена ви е цел в ${v.workspace} в InTime.\n\n` +
        `Отворете InTime, за да я видите:\n${v.link}`,
    },
    'attendance.reminder': {
      subject: (v) => `Отметка за пристигане в ${v.workspace} е още отворена`,
      text: (v) =>
        `Здравейте,\n\nимате отметка за пристигане в ${v.workspace} в InTime, която не е приключена.\n\n` +
        `Отворете InTime, за да отбележите излизане или да я коригирате:\n${v.link}`,
    },
    'time.timer_reminder': {
      subject: (v) => `Таймерът ви в ${v.workspace} още работи`,
      text: (v) =>
        `Здравейте,\n\nза вас още работи таймер в ${v.workspace} в InTime.\n\n` +
        `Отворете InTime, за да го спрете:\n${v.link}`,
    },
    'timesheet.decided': {
      subject: (v) => `Решение по вашия график на часовете в ${v.workspace}`,
      text: (v) =>
        `Здравейте,\n\nима решение по вашия график на часовете в ${v.workspace} в InTime.\n\n` +
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
