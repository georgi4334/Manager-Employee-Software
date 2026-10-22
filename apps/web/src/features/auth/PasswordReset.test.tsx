import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, errorResponse, server, signedOutHandlers } from '@/tests/server';
import { renderApp } from '@/tests/utils';

const TOKEN = 'b'.repeat(43);
const GOOD = 'a completely different passphrase';

function forgotServer(
  respond: () => Response | Promise<Response> = () => new HttpResponse(null, { status: 202 }),
) {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    ...signedOutHandlers(),
    http.post(`${API}/auth/password/forgot`, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return respond();
    }),
  );
  return bodies;
}

function resetServer(
  respond: () => Response | Promise<Response> = () => new HttpResponse(null, { status: 204 }),
) {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    ...signedOutHandlers(),
    http.post(`${API}/auth/password/reset`, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return respond();
    }),
  );
  return bodies;
}

describe('ForgotPasswordPage', () => {
  const request = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: 'Send reset link' }));

  it('sends a normalized email and shows a neutral confirmation', async () => {
    const bodies = forgotServer();
    await renderApp('/forgot-password');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), '  Maria@ACME.eu ');
    await request(user);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'If an account exists for this email',
    );
    expect(bodies).toEqual([{ email: 'maria@acme.eu' }]);
    expect(screen.queryByRole('button', { name: 'Send reset link' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
  });

  it.each([
    ['empty', '', 'This field is required.'],
    ['malformed', 'not-an-email', 'Enter a valid email address.'],
  ])('rejects an %s email without calling the server', async (_label, value, message) => {
    const bodies = forgotServer();
    await renderApp('/forgot-password');
    const user = userEvent.setup();
    if (value) await user.type(await screen.findByLabelText('Email'), value);
    else await screen.findByLabelText('Email');
    await request(user);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it.each([
    ['RATE_LIMITED', 429, 'Too many attempts. Please wait a few minutes and try again.'],
    ['INTERNAL_ERROR', 500, 'Something went wrong on our side. Please try again.'],
  ])('shows %s and keeps the form', async (code, status, text) => {
    forgotServer(() => errorResponse(code, status));
    await renderApp('/forgot-password');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'maria@acme.eu');
    await request(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
  });
});

describe('ResetPasswordPage', () => {
  const save = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: 'Save new password' }));
  const fill = async (password: string, confirm = password) => {
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), password);
    await user.type(screen.getByLabelText('Repeat new password'), confirm);
    return user;
  };

  it('sets the new password and tells the user to sign in again', async () => {
    const bodies = resetServer();
    await renderApp(`/reset-password?token=${TOKEN}`);
    await save(await fill(GOOD));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'You have been signed out everywhere',
    );
    expect(bodies).toEqual([{ token: TOKEN, password: GOOD }]);
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
  });

  it.each([
    ['too short', 'short', 'short', 'Use at least 12 characters.'],
    ['mismatching', GOOD, `${GOOD}x`, 'The passwords do not match.'],
  ])(
    'rejects %s passwords without calling the server',
    async (_label, password, confirm, message) => {
      const bodies = resetServer();
      await renderApp(`/reset-password?token=${TOKEN}`);
      await save(await fill(password, confirm));
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(bodies).toEqual([]);
    },
  );

  it.each([
    ['no token', '/reset-password'],
    ['a malformed token', '/reset-password?token=nope'],
  ])('shows an unusable-link page for %s', async (_label, path) => {
    resetServer();
    await renderApp(path);
    expect(
      await screen.findByRole('heading', { name: 'This link cannot be used' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('shows the unusable-link page when the server says the link is expired or used', async () => {
    resetServer(() => errorResponse('TOKEN_INVALID', 400));
    await renderApp(`/reset-password?token=${TOKEN}`);
    await save(await fill(GOOD));
    expect(
      await screen.findByRole('heading', { name: 'This link cannot be used' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('This link is invalid, expired or has already been used.'),
    ).toBeInTheDocument();
  });

  it('translates the rule the API rejected (the page does not know the email)', async () => {
    resetServer(() =>
      errorResponse('VALIDATION_FAILED', 400, {
        details: [{ path: 'password', code: 'password_contains_email', message: 'x' }],
      }),
    );
    await renderApp(`/reset-password?token=${TOKEN}`);
    await save(await fill('my maria password 2026'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The password must not contain your email name.',
    );
  });

  it('shows a network problem and lets the user try again', async () => {
    let up = false;
    resetServer(() => (up ? new HttpResponse(null, { status: 204 }) : HttpResponse.error()));
    await renderApp(`/reset-password?token=${TOKEN}`);
    const user = await fill(GOOD);
    await save(user);
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server");
    up = true;
    await save(user);
    expect(await screen.findByRole('status')).toHaveTextContent('Your password has been changed');
  });
});
