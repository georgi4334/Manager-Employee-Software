import { ERROR_CODES } from '@intime/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '@/i18n/languages';
import { resources } from '@/tests/i18n';
import { initTestI18n } from '@/tests/i18n';
import { API, errorResponse, server, signedOutHandlers } from '@/tests/server';
import { renderApp } from '@/tests/utils';

const TOKEN = 'c'.repeat(43);
const CLIENT_CODES = ['NETWORK', 'TIMEOUT', 'UNKNOWN'];

describe('API error translations', () => {
  it.each(LANGUAGES)('%s translates every API error code and client-side error', (language) => {
    const api = (resources[language]?.errors as { api: Record<string, string> }).api;
    for (const code of [...ERROR_CODES, ...CLIENT_CODES]) {
      expect(api[code], `${language}: errors.api.${code}`).toBeTruthy();
    }
    expect(Object.keys(api).sort()).toEqual([...ERROR_CODES, ...CLIENT_CODES].sort());
  });
});

// A missing key makes i18next print the key itself, e.g. "login.title" or "api.UNKNOWN".
const looksLikeKey = /\b(login|forgot|reset|accept|validation|api)\.[A-Za-z_]+\b/;
const expectNoRawKeys = () => expect(document.body.textContent).not.toMatch(looksLikeKey);

describe.each([
  [
    'de',
    {
      signIn: 'Anmelden',
      email: 'E-Mail',
      password: 'Passwort',
      required: 'Dieses Feld ist erforderlich.',
      invalid: 'E-Mail oder Passwort ist falsch.',
      accept: 'Konto aktivieren',
      forgot: 'Passwort zurücksetzen',
    },
  ],
  [
    'bg',
    {
      signIn: 'Вход',
      email: 'Имейл',
      password: 'Парола',
      required: 'Това поле е задължително.',
      invalid: 'Грешен имейл или парола.',
      accept: 'Активирай акаунта',
      forgot: 'Смяна на паролата',
    },
  ],
] as const)('auth screens in %s', (language, text) => {
  it('login: labels, validation and API errors are translated', async () => {
    await initTestI18n(language);
    server.use(
      ...signedOutHandlers(),
      http.post(`${API}/auth/login`, () => errorResponse('INVALID_CREDENTIALS', 401)),
    );
    await renderApp('/login');
    expect(screen.getByRole('heading', { name: text.signIn })).toBeInTheDocument();
    expect(screen.getByLabelText(text.email)).toBeInTheDocument();
    expect(screen.getByLabelText(text.password)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: text.signIn }));
    expect((await screen.findAllByText(text.required)).length).toBe(2);

    await user.type(screen.getByLabelText(text.email), 'maria@acme.eu');
    await user.type(screen.getByLabelText(text.password), 'wrong password');
    await user.click(screen.getByRole('button', { name: text.signIn }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text.invalid);
    expectNoRawKeys();
  });

  it('forgot password page is translated', async () => {
    await initTestI18n(language);
    server.use(...signedOutHandlers());
    await renderApp('/forgot-password');
    expect(await screen.findByRole('heading', { name: text.forgot })).toBeInTheDocument();
    expectNoRawKeys();
  });

  it('invitation page is translated, including the password hint with its number', async () => {
    await initTestI18n(language);
    server.use(
      ...signedOutHandlers(),
      http.post(`${API}/auth/invitations/inspect`, () =>
        HttpResponse.json({
          email: 'maria@acme.eu',
          workspace: { slug: 'acme', name: 'Acme GmbH' },
        }),
      ),
    );
    await renderApp(`/accept-invitation?token=${TOKEN}`);
    expect(await screen.findByRole('button', { name: text.accept })).toBeInTheDocument();
    expect(document.body.textContent).toContain('12');
    expect(document.body.textContent).not.toContain('{{');
    expectNoRawKeys();
  });

  it('unusable link pages are translated', async () => {
    await initTestI18n(language);
    server.use(...signedOutHandlers());
    await renderApp('/reset-password');
    expect(screen.getByRole('link', { name: /.+/ })).toBeInTheDocument();
    expectNoRawKeys();
  });
});
