import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, server } from '@/tests/server';
import { renderApp } from '@/tests/utils';
import { notificationKeys } from './api';

function unreadServer(initial: number) {
  const state = { count: initial };
  server.use(
    http.get(`${API}/notifications/unread-count`, () =>
      HttpResponse.json({ unreadCount: state.count }),
    ),
  );
  return state;
}

const refetch = (client: Awaited<ReturnType<typeof renderApp>>['client']) =>
  act(() => client.refetchQueries({ queryKey: notificationKeys.unreadCount }));

describe('notification toast', () => {
  it('stays quiet on the first answer, however many are unread', async () => {
    unreadServer(5);
    await renderApp('/');
    await screen.findByRole('link', { name: 'Notifications, 5 unread' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('appears when new notifications arrive and says how many', async () => {
    const state = unreadServer(1);
    const { client } = await renderApp('/');
    await screen.findByRole('link', { name: 'Notifications, 1 unread' });
    state.count = 2;
    await refetch(client);
    expect(await screen.findByRole('status')).toHaveTextContent('You have a new notification');
    state.count = 5;
    await refetch(client);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('You have 3 new notifications'),
    );
  });

  it('can be dismissed and links to the inbox', async () => {
    const state = unreadServer(0);
    const { client, router } = await renderApp('/');
    await screen.findByRole('link', { name: 'Notifications, 0 unread' });
    state.count = 1;
    await refetch(client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    state.count = 2;
    await refetch(client);
    await user.click(await screen.findByRole('link', { name: 'View' }));
    expect(router.state.location.pathname).toBe('/notifications');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not interrupt the inbox page itself', async () => {
    const state = unreadServer(0);
    const { client } = await renderApp('/notifications');
    state.count = 3;
    await refetch(client);
    await screen.findByRole('link', { name: 'Notifications, 3 unread' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not announce a smaller count', async () => {
    const state = unreadServer(4);
    const { client } = await renderApp('/');
    await screen.findByRole('link', { name: 'Notifications, 4 unread' });
    state.count = 1;
    await refetch(client);
    await screen.findByRole('link', { name: 'Notifications, 1 unread' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
