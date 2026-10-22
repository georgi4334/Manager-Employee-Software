export const EMAIL_LOCALES = ['en', 'de', 'bg'] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

export type EmailKind = 'invite' | 'password_reset';

export interface EmailVars {
  workspace: string;
  link: string;
  /** How long the link stays valid, in hours. */
  hours: number;
}

type Template = { subject: (v: EmailVars) => string; text: (v: EmailVars) => string };

// Keep the three languages in sync; templates.test.ts checks every kind exists in every locale.
const TEMPLATES: Record<EmailLocale, Record<EmailKind, Template>> = {
  en: {
    invite: {
      subject: (v) => `You are invited to ${v.workspace} on InTime`,
      text: (v) =>
        `Hello,\n\nyou have been invited to join ${v.workspace} on InTime.\n\n` +
        `Set your password here (the link is valid for ${v.hours} hours):\n${v.link}\n\n` +
        `If you did not expect this invitation, you can ignore this email.`,
    },
    password_reset: {
      subject: () => 'Reset your InTime password',
      text: (v) =>
        `Hello,\n\nsomeone asked to reset your InTime password for ${v.workspace}.\n\n` +
        `Choose a new password here (the link is valid for ${v.hours} hour(s)):\n${v.link}\n\n` +
        `If this was not you, ignore this email; your password stays unchanged.`,
    },
  },
  de: {
    invite: {
      subject: (v) => `Einladung zu ${v.workspace} auf InTime`,
      text: (v) =>
        `Hallo,\n\nSie wurden eingeladen, ${v.workspace} auf InTime beizutreten.\n\n` +
        `Legen Sie hier Ihr Passwort fest (der Link ist ${v.hours} Stunden gültig):\n${v.link}\n\n` +
        `Falls Sie diese Einladung nicht erwartet haben, können Sie diese E-Mail ignorieren.`,
    },
    password_reset: {
      subject: () => 'InTime-Passwort zurücksetzen',
      text: (v) =>
        `Hallo,\n\njemand hat das Zurücksetzen Ihres InTime-Passworts für ${v.workspace} angefordert.\n\n` +
        `Wählen Sie hier ein neues Passwort (der Link ist ${v.hours} Stunde(n) gültig):\n${v.link}\n\n` +
        `Falls Sie das nicht waren, ignorieren Sie diese E-Mail; Ihr Passwort bleibt unverändert.`,
    },
  },
  bg: {
    invite: {
      subject: (v) => `Покана за ${v.workspace} в InTime`,
      text: (v) =>
        `Здравейте,\n\nпоканени сте да се присъедините към ${v.workspace} в InTime.\n\n` +
        `Задайте парола тук (връзката е валидна ${v.hours} часа):\n${v.link}\n\n` +
        `Ако не очаквате тази покана, просто игнорирайте този имейл.`,
    },
    password_reset: {
      subject: () => 'Смяна на паролата за InTime',
      text: (v) =>
        `Здравейте,\n\nполучихме заявка за смяна на паролата ви за InTime в ${v.workspace}.\n\n` +
        `Изберете нова парола тук (връзката е валидна ${v.hours} час(а)):\n${v.link}\n\n` +
        `Ако не сте били вие, игнорирайте този имейл; паролата ви остава непроменена.`,
    },
  },
};

export function resolveEmailLocale(...candidates: (string | null | undefined)[]): EmailLocale {
  for (const candidate of candidates) {
    if (candidate && (EMAIL_LOCALES as readonly string[]).includes(candidate)) {
      return candidate as EmailLocale;
    }
  }
  return 'en';
}

export function renderEmail(kind: EmailKind, locale: EmailLocale, vars: EmailVars) {
  const template = TEMPLATES[locale][kind];
  return { subject: template.subject(vars), text: template.text(vars) };
}

export { TEMPLATES as EMAIL_TEMPLATES };
