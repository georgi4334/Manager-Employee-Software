import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, errorResponse, server, signedOutHandlers, testUser } from '@/tests/server';
import { renderApp } from '@/tests/utils';

/** Signed out until a login request succeeds; records the bodies that were sent. */
function loginServer(
  respond?: () => Response | Promise<Response>,
  options: { google?: boolean } = {},
) {
  const requests: Record<string, unknown>[] = [];
  let signedIn = false;
  server.use(
    http.get(`${API}/auth/me`, () =>
      signedIn ? HttpResponse.json(testUser) : errorResponse('UNAUTHENTICATED', 401),
    ),
    http.post(`${API}/auth/refresh`, () => errorResponse('UNAUTHENTICATED', 401)),
    http.get(`${API}/auth/providers`, () => HttpResponse.json({ google: options.google ?? false })),
    http.post(`${API}/auth/login`, async ({ request }) => {
      requests.push((await request.json()) as Record<string, unknown>);
      if (respond) return respond();
      signedIn = true;
      return HttpResponse.json(testUser);
    }),
  );
  return requests;
}

const fill = async (email: string, password: string) => {
  const user = userEvent.setup();
  if (email) await user.type(screen.getByLabelText('Email'), email);
  if (password) await user.type(screen.getByLabelText('Password'), password);
  return user;
};
const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Sign in' }));

describe('LoginPage', () => {
  it('shows the sign-in form to signed-out visitors', async () => {
    server.use(...signedOutHandlers());
    await renderApp('/login');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.getByText(/invite-only/)).toBeInTheDocument();
  });

  it('signs in, sends a normalized email and shows the dashboard', async () => {
    const requests = loginServer();
    await renderApp('/login');
    const user = await fill('  Maria@ACME.eu ', 'correct horse');
    await submit(user);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(requests).toEqual([{ email: 'maria@acme.eu', password: 'correct horse' }]);
  });

  it('shows required messages and sends nothing when the form is empty', async () => {
    const requests = loginServer();
    await renderApp('/login');
    await submit(userEvent.setup());
    expect(await screen.findAllByText('This field is required.')).toHaveLength(2);
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(requests).toEqual([]);
  });

  it('shows an email format message and sends nothing', async () => {
    const requests = loginServer();
    await renderApp('/login');
    await submit(await fill('not-an-email', 'x'));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it.each([
    ['INVALID_CREDENTIALS', 401, 'Incorrect email or password.'],
    ['ACCOUNT_DISABLED', 403, 'This account has been disabled. Contact your administrator.'],
    ['RATE_LIMITED', 429, 'Too many attempts. Please wait a few minutes and try again.'],
    [
      'SERVICE_UNAVAILABLE',
      503,
      'The service is temporarily unavailable. Please try again shortly.',
    ],
    ['INTERNAL_ERROR', 500, 'Something went wrong on our side. Please try again.'],
  ])('shows the translated message for %s', async (code, status, text) => {
    loginServer(() => errorResponse(code, status));
    await renderApp('/login');
    await submit(await fill('maria@acme.eu', 'wrong password'));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows a network message when the server cannot be reached', async () => {
    loginServer(() => HttpResponse.error());
    await renderApp('/login');
    await submit(await fill('maria@acme.eu', 'whatever pass'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Can't reach the server. Check your connection and try again.",
    );
  });

  it('shows a generic message for a response that is not in the API error format', async () => {
    loginServer(() => new HttpResponse('<html>Bad gateway</html>', { status: 502 }));
    await renderApp('/login');
    await submit(await fill('maria@acme.eu', 'whatever pass'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    );
  });

  it('disables the button while signing in', async () => {
    let release = () => {};
    loginServer(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(HttpResponse.json(testUser));
        }),
    );
    await renderApp('/login');
    const user = await fill('maria@acme.eu', 'correct horse');
    await submit(user);
    expect(await screen.findByRole('button', { name: 'Signing in…' })).toBeDisabled();
    release();
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
  });

  it('can show and hide the password', async () => {
    server.use(...signedOutHandlers());
    await renderApp('/login');
    const user = userEvent.setup();
    const password = screen.getByLabelText('Password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  describe('several workspaces', () => {
    const workspaces = [
      { slug: 'acme', name: 'Acme GmbH' },
      { slug: 'beta', name: 'Beta AG' },
    ];

    it('asks which workspace, then signs in to the chosen one', async () => {
      const requests: Record<string, unknown>[] = [];
      let signedIn = false;
      server.use(
        http.get(`${API}/auth/me`, () =>
          signedIn ? HttpResponse.json(testUser) : errorResponse('UNAUTHENTICATED', 401),
        ),
        http.post(`${API}/auth/refresh`, () => errorResponse('UNAUTHENTICATED', 401)),
        http.get(`${API}/auth/providers`, () => HttpResponse.json({ google: false })),
        http.post(`${API}/auth/login`, async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          requests.push(body);
          if (!body.workspace)
            return errorResponse('TENANT_SELECTION_REQUIRED', 409, { params: { workspaces } });
          signedIn = true;
          return HttpResponse.json(testUser);
        }),
      );
      await renderApp('/login');
      await submit(await fill('maria@acme.eu', 'correct horse'));

      const chooser = await screen.findByRole('region', { name: 'Choose your workspace' });
      expect(
        within(chooser)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual(['Acme GmbH', 'Beta AG']);
      expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      await userEvent.setup().click(within(chooser).getByRole('button', { name: 'Beta AG' }));
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Dashboard' }),
      ).toBeInTheDocument();
      expect(requests).toEqual([
        { email: 'maria@acme.eu', password: 'correct horse' },
        { email: 'maria@acme.eu', password: 'correct horse', workspace: 'beta' },
      ]);
    });

    it('goes back to the normal form when the second attempt fails', async () => {
      server.use(
        ...signedOutHandlers(),
        http.post(`${API}/auth/login`, async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          return body.workspace
            ? errorResponse('INVALID_CREDENTIALS', 401)
            : errorResponse('TENANT_SELECTION_REQUIRED', 409, { params: { workspaces } });
        }),
      );
      await renderApp('/login');
      await submit(await fill('maria@acme.eu', 'correct horse'));
      await userEvent.setup().click(await screen.findByRole('button', { name: 'Acme GmbH' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    });
  });

  describe('Google sign-in', () => {
    it('is not offered when the server has it switched off', async () => {
      loginServer(undefined, { google: false });
      await renderApp('/login');
      expect(screen.queryByRole('link', { name: 'Continue with Google' })).not.toBeInTheDocument();
    });

    it('is a plain link to the API when available', async () => {
      loginServer(undefined, { google: true });
      await renderApp('/login');
      const link = await screen.findByRole('link', { name: 'Continue with Google' });
      expect(link).toHaveAttribute('href', 'http://localhost:3000/api/v1/auth/google/start');
    });

    it.each([
      ['INVALID_CREDENTIALS', 'Incorrect email or password.'],
      ['ACCOUNT_DISABLED', 'This account has been disabled. Contact your administrator.'],
      ['SOMETHING_ELSE', 'Something went wrong. Please try again.'],
    ])('explains a failed Google sign-in (?error=%s)', async (code, text) => {
      loginServer(undefined, { google: true });
      await renderApp(`/login?error=${code}`);
      expect(screen.getByRole('alert')).toHaveTextContent(text);
    });

    it('asks for the workspace when the Google email exists in several, and passes it on', async () => {
      loginServer(undefined, { google: true });
      await renderApp('/login?error=TENANT_SELECTION_REQUIRED');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await userEvent.setup().type(await screen.findByLabelText('Workspace address'), ' Beta-AG ');
      expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
        'href',
        'http://localhost:3000/api/v1/auth/google/start?workspace=beta-ag',
      );
    });

    it('ignores an invalid workspace instead of putting it into the URL', async () => {
      loginServer(undefined, { google: true });
      await renderApp('/login?error=TENANT_SELECTION_REQUIRED');
      await userEvent
        .setup()
        .type(await screen.findByLabelText('Workspace address'), "x'&y=<script>");
      expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
        'href',
        'http://localhost:3000/api/v1/auth/google/start',
      );
    });
  });

  describe('where to go after signing in', () => {
    it('returns to the page the user wanted', async () => {
      loginServer();
      await renderApp('/login', { entries: [{ pathname: '/login', state: { from: '/leave' } }] });
      await submit(await fill('maria@acme.eu', 'correct horse'));
      expect(await screen.findByRole('heading', { level: 1, name: 'Leave' })).toBeInTheDocument();
    });

    it.each(['https://evil.example', '//evil.example', 'javascript:alert(1)'])(
      'ignores an unsafe target %s',
      async (from) => {
        loginServer();
        const { router } = await renderApp('/login', {
          entries: [{ pathname: '/login', state: { from } }],
        });
        await submit(await fill('maria@acme.eu', 'correct horse'));
        await waitFor(() => expect(router.state.location.pathname).toBe('/'));
        expect(
          await screen.findByRole('heading', { level: 1, name: 'Dashboard' }),
        ).toBeInTheDocument();
      },
    );
  });
});
