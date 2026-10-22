import { describe, expect, it } from 'vitest';
import {
  EMAIL_LOCALES,
  EMAIL_TEMPLATES,
  renderEmail,
  resolveEmailLocale,
  type EmailKind,
} from './templates.js';

const KINDS: EmailKind[] = ['invite', 'password_reset'];
const vars = { workspace: 'Acme GmbH', link: 'https://app.example/x?token=abc', hours: 7 };

describe('email templates', () => {
  it('has every kind in every language', () => {
    for (const locale of EMAIL_LOCALES) {
      expect(Object.keys(EMAIL_TEMPLATES[locale]).sort()).toEqual([...KINDS].sort());
    }
  });

  describe.each(EMAIL_LOCALES)('%s', (locale) => {
    it.each(KINDS)('%s contains the link, the validity and a non-empty subject', (kind) => {
      const email = renderEmail(kind, locale, vars);
      expect(email.subject.trim()).not.toBe('');
      expect(email.text).toContain(vars.link);
      expect(email.text).toContain('7');
    });
  });

  it('is actually translated (subjects differ between languages)', () => {
    for (const kind of KINDS) {
      const subjects = EMAIL_LOCALES.map((locale) => renderEmail(kind, locale, vars).subject);
      expect(new Set(subjects).size).toBe(EMAIL_LOCALES.length);
    }
  });
});

describe('resolveEmailLocale', () => {
  it('takes the first supported candidate', () => {
    expect(resolveEmailLocale(null, 'de', 'bg')).toBe('de');
    expect(resolveEmailLocale('bg', 'de')).toBe('bg');
  });

  it('falls back to English', () => {
    expect(resolveEmailLocale('fr', undefined, null)).toBe('en');
    expect(resolveEmailLocale()).toBe('en');
  });
});
