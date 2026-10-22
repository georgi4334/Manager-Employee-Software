import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { initTestI18n } from '@/tests/i18n';
import { renderApp } from '@/tests/utils';
import { formatDate, formatNumber } from '@/shared/lib/format';
import { changeLanguage, i18n } from '.';
import { LANGUAGE_STORAGE_KEY } from './languages';

describe('language switcher', () => {
  it('lists the three languages by their native names', async () => {
    await renderApp('/');
    const select = screen.getByRole('combobox', { name: 'Language' });
    const names = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(names).toEqual(['English', 'Deutsch', 'Български']);
  });

  it('switches the UI to German and updates <html lang>, persisting the choice', async () => {
    await renderApp('/');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'de');
    expect(await screen.findByRole('heading', { level: 1, name: 'Übersicht' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sprache' })).toHaveValue('de');
    expect(document.documentElement.lang).toBe('de');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('de');
  });

  it('switches the UI to Bulgarian including navigation labels', async () => {
    await renderApp('/');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'bg');
    const sidebar = await screen.findByRole('navigation', { name: 'Основна навигация' });
    expect(within(sidebar).getByRole('link', { name: 'Присъствие' })).toBeInTheDocument();
  });

  it('translates the not-found page', async () => {
    await initTestI18n('de');
    await renderApp('/gibt-es-nicht');
    expect(screen.getByRole('heading', { name: 'Seite nicht gefunden' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zurück zur Übersicht' })).toBeInTheDocument();
  });

  it('ignores an unsupported language instead of breaking the UI', async () => {
    await renderApp('/');
    await changeLanguage('fr' as never);
    expect(i18n.resolvedLanguage).toBe('en');
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });
});

describe('plurals', () => {
  it.each([
    ['en', 1, '1 day'],
    ['en', 5, '5 days'],
    ['de', 1, '1 Tag'],
    ['de', 2, '2 Tage'],
    ['bg', 1, '1 ден'],
    ['bg', 3, '3 дни'],
  ] as const)('%s with count %i -> %s', async (language, count, expected) => {
    await initTestI18n(language);
    expect(i18n.t('days', { count })).toBe(expected);
  });
});

describe('fallback', () => {
  it('falls back to English for a key missing in the active language', async () => {
    await initTestI18n('de');
    i18n.addResource('en', 'common', 'onlyEnglish', 'Only in English');
    expect(i18n.t('onlyEnglish' as never)).toBe('Only in English');
  });
});

describe('formatting', () => {
  const date = new Date(Date.UTC(2026, 9, 21, 12));

  it('formats dates per language', () => {
    expect(formatDate(date, 'en', { dateStyle: 'short', timeZone: 'UTC' })).toBe('21/10/2026');
    expect(formatDate(date, 'de', { dateStyle: 'short', timeZone: 'UTC' })).toBe('21.10.26');
    expect(formatDate(date, 'bg', { dateStyle: 'short', timeZone: 'UTC' })).toContain('21.10.26');
  });

  it('returns an empty string for invalid dates and numbers', () => {
    expect(formatDate('not a date', 'en')).toBe('');
    expect(formatNumber(Number.NaN, 'de')).toBe('');
    expect(formatNumber(Infinity, 'de')).toBe('');
  });

  it('formats numbers per language and falls back for unknown ones', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'de')).toBe('1.234,5');
    expect(formatNumber(1234.5, 'xx')).toBe('1,234.5');
  });
});
