import { NOTIFICATION_TYPE_KEYS } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import {
  EMAIL_LOCALES,
  NOTIFICATION_EMAIL_TEMPLATES,
  renderNotificationEmail,
} from './email-templates.js';

const vars = { workspace: 'Acme GmbH', link: 'https://app.example/notifications' };

describe('notification emails', () => {
  it('exist for every notification type in every language', () => {
    for (const locale of EMAIL_LOCALES) {
      expect(Object.keys(NOTIFICATION_EMAIL_TEMPLATES[locale]).sort()).toEqual(
        [...NOTIFICATION_TYPE_KEYS].sort(),
      );
    }
  });

  describe.each(EMAIL_LOCALES)('%s', (locale) => {
    it.each(NOTIFICATION_TYPE_KEYS)(
      '%s: has a subject, names the workspace and links into the app',
      (type) => {
        const email = renderNotificationEmail(type, locale, vars);
        expect(email.subject.trim()).not.toBe('');
        expect(email.subject).toContain('Acme GmbH');
        expect(email.text).toContain(vars.link);
        expect(email.text).toContain('Acme GmbH');
      },
    );
  });

  it('are actually translated', () => {
    for (const type of NOTIFICATION_TYPE_KEYS) {
      const subjects = EMAIL_LOCALES.map(
        (locale) => renderNotificationEmail(type, locale, vars).subject,
      );
      expect(new Set(subjects).size).toBe(EMAIL_LOCALES.length);
    }
  });

  it('never contain the details of a change (email is not a secure channel)', () => {
    for (const locale of EMAIL_LOCALES) {
      const email = renderNotificationEmail('account.roles_changed', locale, vars);
      // Templates only receive the workspace name and a link: there is nothing else they could print.
      expect(Object.keys(vars).sort()).toEqual(['link', 'workspace']);
      expect(email.text).not.toMatch(/\b(Admin|HR|Manager|Employee)\b/);
    }
  });
});
