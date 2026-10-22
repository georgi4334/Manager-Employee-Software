import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, errorResponse, server, signedOutHandlers, testUser } from '@/tests/server';
import { renderApp } from '@/tests/utils';

const TOKEN = 'a'.repeat(43);
const GOOD = 'correct horse battery staple';
const info = { email: 'maria@acme.eu', workspace: { slug: 'acme', name: 'Acme GmbH' } };

function inviteServer(
  options: {
    inspect?: () => Response | Promise<Response>;
    accept?: () => Response | Promise<Response>;
  } = {},
) {
  const calls = { inspect: 0, accept: [] as Record<string, unknown>[] };
  let signedIn = false;
  server.use(
    http.get(`${API}/auth/me`, () =>
      signedIn ? HttpResponse.json(testUser) : errorResponse('UNAUTHENTICATED', 401),
    ),
    http.post(`${API}/auth/refresh`, () => errorResponse('UNAUTHENTICATED', 401)),
    http.post(`${API}/auth/invitations/inspect`, () => {
      calls.inspect++;
      return options.inspect ? options.inspect() : HttpResponse.json(info);
    }),
    http.post(`${API}/auth/invitations/accept`, async ({ request }) => {
      calls.accept.push((await request.json()) as Record<string, unknown>);
      if (options.accept) return options.accept();
      signedIn = true;
      return HttpResponse.json(testUser);
    }),
  );
  return calls;
}

const fillPasswords = async (password: string, confirm = password) => {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Password'), password);
  await user.type(screen.getByLabelText('Repeat password'), confirm);
  return user;
};
const activate = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Activate account' }));

describe('AcceptInvitationPage', () => {
  it('shows the workspace and the invited email (read-only)', async () => {
    inviteServer();
    await renderApp(`/accept-invitation?token=${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Join Acme GmbH' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('maria@acme.eu');
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
    expect(
      screen.getByText('At least 12 characters. Do not use your email name.'),
    ).toBeInTheDocument();
  });

  it('says so while it checks the invitation', async () => {
    let release = () => {};
    inviteServer({
      inspect: () =>
        new Promise<Response>((resolve) => (release = () => resolve(HttpResponse.json(info)))),
    });
    const pending = renderApp(`/accept-invitation?token=${TOKEN}`);
    expect(await screen.findByText('Checking your invitation…')).toBeInTheDocument();
    release();
    await pending;
    expect(await screen.findByRole('heading', { name: 'Join Acme GmbH' })).toBeInTheDocument();
  });

  it('activates the account and signs the user in', async () => {
    const calls = inviteServer();
    await renderApp(`/accept-invitation?token=${TOKEN}`);
    await activate(await fillPasswords(GOOD));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(calls.accept).toEqual([{ token: TOKEN, password: GOOD }]);
    expect(screen.getByRole('banner')).toHaveTextContent('maria@acme.eu');
  });

  it.each([
    ['too short', 'short', 'short', 'Use at least 12 characters.'],
    ['mismatching', GOOD, `${GOOD}!`, 'The passwords do not match.'],
    [
      'containing the email name',
      'my maria password 2026',
      'my maria password 2026',
      'The password must not contain your email name.',
    ],
    ['repetitive', 'a'.repeat(14), 'a'.repeat(14), 'The password is too repetitive.'],
  ])(
    'rejects %s passwords before calling the server',
    async (_label, password, confirm, message) => {
      const calls = inviteServer();
      await renderApp(`/accept-invitation?token=${TOKEN}`);
      await activate(await fillPasswords(password, confirm));
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(calls.accept).toEqual([]);
    },
  );

  it('shows required messages for empty fields', async () => {
    inviteServer();
    await renderApp(`/accept-invitation?token=${TOKEN}`);
    await screen.findByRole('heading', { name: 'Join Acme GmbH' });
    await activate(userEvent.setup());
    expect(await screen.findAllByText('This field is required.')).toHaveLength(2);
  });

  it.each([
    ['no token', '/accept-invitation'],
    ['a malformed token', '/accept-invitation?token=short'],
    ['an injected token', `/accept-invitation?token=${'a'.repeat(42)}%3Cscript%3E`],
  ])('treats %s as an unusable link without calling the server', async (_label, path) => {
    const calls = inviteServer();
    await renderApp(path);
    expect(
      await screen.findByRole('heading', { name: 'This invitation cannot be used' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
    expect(calls.inspect).toBe(0);
  });

  it('treats an unknown, expired or used invitation as unusable', async () => {
    inviteServer({ inspect: () => errorResponse('TOKEN_INVALID', 400) });
    await renderApp(`/accept-invitation?token=${TOKEN}`);
    expect(
      await screen.findByRole('heading', { name: 'This invitation cannot be used' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/new invitation/)).toBeInTheDocument();
  });

  it('explains a network problem and lets the user retry', async () => {
    let up = false;
    inviteServer({ inspect: () => (up ? HttpResponse.json(info) : HttpResponse.error()) });
    await renderApp(`/accept-invitation?token=${TOKEN}`);
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server");
    up = true;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Join Acme GmbH' })).toBeInTheDocument();
  });

  it('shows the API message when the link was used in the meantime', async () => {
    inviteServer({ accept: () => errorResponse('TOKEN_INVALID', 400) });
    await renderApp(`/accept-invitation?token=${TOKEN}`);
    await activate(await fillPasswords(GOOD));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This link is invalid, expired or has already been used.',
    );
  });

  it('translates the exact rule the API rejected', async () => {
    inviteServer({
      accept: () =>
        errorResponse('VALIDATION_FAILED', 400, {
          details: [{ path: 'password', code: 'password_contains_email', message: 'x' }],
        }),
    });
    await renderApp(`/accept-invitation?token=${TOKEN}`);
    await activate(await fillPasswords(GOOD));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The password must not contain your email name.',
    );
  });

  it('works for a visitor who is signed out and sets no sign-in state before success', async () => {
    server.use(...signedOutHandlers());
    inviteServer();
    await renderApp(`/accept-invitation?token=${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Join Acme GmbH' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  });
});
