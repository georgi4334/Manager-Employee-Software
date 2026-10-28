import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { useApiStatusStore } from '@/shared/api/api-status.store';
import { API, errorResponse, server, signedOutHandlers, testUser } from '@/tests/server';
import { openAccountMenu, renderApp } from '@/tests/utils';
import { authKeys } from './api';

describe('RequireAuth', () => {
  it('shows the app to a signed-in user', async () => {
    await renderApp('/leave');
    expect(screen.getByRole('heading', { level: 1, name: 'Leave' })).toBeInTheDocument();
  });

  it('sends a signed-out visitor to the login page', async () => {
    server.use(...signedOutHandlers());
    const { router } = await renderApp('/leave');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  });

  it('remembers where the visitor wanted to go', async () => {
    server.use(...signedOutHandlers());
    const { router } = await renderApp('/leave?tab=2');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect((router.state.location.state as { from: string }).from).toBe('/leave?tab=2');
  });

  it('shows a loading message while it asks who is signed in', async () => {
    let release = () => {};
    server.use(
      http.get(
        `${API}/auth/me`,
        () =>
          new Promise<Response>(
            (resolve) => (release = () => resolve(HttpResponse.json(testUser))),
          ),
      ),
    );
    const pending = renderApp('/');
    const splash = await screen.findByRole('status');
    expect(splash).toHaveTextContent('Loading…');
    expect(splash).toHaveTextContent('InTime');
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    release();
    await pending;
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });

  it('offers a retry when the server cannot be reached, then recovers', async () => {
    let up = false;
    server.use(
      http.get(`${API}/auth/me`, () => (up ? HttpResponse.json(testUser) : HttpResponse.error())),
    );
    await renderApp('/');
    expect(screen.getByText("Can't reach the server")).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    up = true;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });

  it('does not treat a server error as "signed out" (no redirect on a 500)', async () => {
    server.use(http.get(`${API}/auth/me`, () => errorResponse('INTERNAL_ERROR', 500)));
    const { router } = await renderApp('/leave');
    expect(router.state.location.pathname).toBe('/leave');
    expect(screen.getByText("Can't reach the server")).toBeInTheDocument();
  });

  it('signs the user out when the session ends while the app is open', async () => {
    const { client, router } = await renderApp('/leave');
    expect(screen.getByRole('heading', { level: 1, name: 'Leave' })).toBeInTheDocument();
    client.setQueryData(['employees', 'list'], ['cached data of the old session']);

    server.use(...signedOutHandlers());
    await act(() => client.invalidateQueries({ queryKey: authKeys.me }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(client.getQueryData(['employees', 'list'])).toBeUndefined();
  });
});

describe('PublicOnly', () => {
  it.each(['/login', '/forgot-password'])('moves a signed-in user away from %s', async (path) => {
    const { router } = await renderApp(path);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('still lets a signed-in user open a password-reset or invitation link', async () => {
    await renderApp(`/reset-password?token=${'a'.repeat(43)}`);
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
  });
});

describe('signing out', () => {
  it('calls the API, clears cached data and shows the login page', async () => {
    let loggedOut = false;
    server.use(
      http.post(`${API}/auth/logout`, () => {
        loggedOut = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { client, router } = await renderApp('/');
    client.setQueryData(['employees', 'list'], ['secret']);

    await userEvent
      .setup()
      .click((await openAccountMenu()).getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(loggedOut).toBe(true);
    expect(client.getQueryData(['employees', 'list'])).toBeUndefined();
    expect(client.getQueryData(authKeys.me)).toBeNull();
  });

  it('signs out locally even when the server cannot be reached', async () => {
    server.use(http.post(`${API}/auth/logout`, () => HttpResponse.error()));
    const { router } = await renderApp('/');
    await userEvent
      .setup()
      .click((await openAccountMenu()).getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('shows who is signed in in the profile drawer, not in the header', async () => {
    await renderApp('/');
    expect(within(screen.getByRole('banner')).queryByText('maria@acme.eu')).not.toBeInTheDocument();
    const drawer = await openAccountMenu();
    expect(drawer.getByText('maria@acme.eu')).toBeInTheDocument();
    expect(drawer.getByText('Acme GmbH · Employee')).toBeInTheDocument();
  });
});

describe('sleeping server notice', () => {
  it('appears while requests are slow and disappears afterwards', async () => {
    await renderApp('/');
    expect(screen.queryByText(/server is waking up/i)).not.toBeInTheDocument();
    act(() => useApiStatusStore.getState().slowStarted());
    expect(screen.getByRole('status')).toHaveTextContent('The server is waking up');
    act(() => useApiStatusStore.getState().slowEnded());
    expect(screen.queryByText(/server is waking up/i)).not.toBeInTheDocument();
  });

  it('never goes below zero', () => {
    useApiStatusStore.setState({ slowRequests: 0 });
    useApiStatusStore.getState().slowEnded();
    expect(useApiStatusStore.getState().slowRequests).toBe(0);
  });
});
