import type { NotificationItem, NotificationList } from '@intime/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { initTestI18n } from '@/tests/i18n';
import {
  API,
  errorResponse,
  server,
  signedInHandlers,
  userWithPermissions,
  userWithRole,
} from '@/tests/server';
import { renderApp } from '@/tests/utils';
import { notificationKeys } from './api';
import { UNREAD_POLL_MS } from './hooks';

const uuid = (n: number) => `0192f5a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const item = (n: number, overrides: Partial<NotificationItem> = {}): NotificationItem => ({
  id: uuid(n),
  type: 'account.roles_changed',
  params: { roleNames: ['HR', 'Manager'] },
  link: '/notifications',
  readAt: null,
  createdAt: '2026-10-21T09:30:00.000Z',
  ...overrides,
});

const list = (
  items: NotificationItem[],
  extra: Partial<NotificationList> = {},
): NotificationList => ({
  items,
  unreadCount: items.filter((i) => i.readAt === null).length,
  nextCursor: null,
  ...extra,
});

function serve(pages: (before: string | null) => NotificationList, unread = 0) {
  const requests: { path: string; before: string | null }[] = [];
  server.use(
    http.get(`${API}/notifications/unread-count`, () => HttpResponse.json({ unreadCount: unread })),
    http.get(`${API}/notifications`, ({ request }) => {
      const before = new URL(request.url).searchParams.get('before');
      requests.push({ path: 'list', before });
      return HttpResponse.json(pages(before));
    }),
    http.post(`${API}/notifications/:id/read`, ({ params }) => {
      requests.push({ path: `read:${String(params.id)}`, before: null });
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${API}/notifications/read-all`, () => {
      requests.push({ path: 'read-all', before: null });
      return HttpResponse.json({ updated: 1 });
    }),
  );
  return requests;
}

describe('notification bell', () => {
  it('shows no badge when nothing is unread, but still links to the inbox', async () => {
    await renderApp('/');
    const bell = screen.getByRole('link', { name: 'Notifications, 0 unread' });
    expect(bell).toHaveAttribute('href', '/notifications');
    expect(within(bell).queryByText(/\d/)).not.toBeInTheDocument();
  });

  it.each([
    [3, '3'],
    [99, '99'],
    [100, '99+'],
    [4000, '99+'],
  ])('shows %i unread as "%s"', async (count, text) => {
    server.use(
      http.get(`${API}/notifications/unread-count`, () =>
        HttpResponse.json({ unreadCount: count }),
      ),
    );
    await renderApp('/');
    const bell = await screen.findByRole('link', { name: `Notifications, ${count} unread` });
    expect(within(bell).getByText(text)).toBeInTheDocument();
  });

  it('is quiet when the count cannot be loaded (no badge, no error, no retry storm)', async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/notifications/unread-count`, () => {
        calls += 1;
        return errorResponse('INTERNAL_ERROR', 500);
      }),
    );
    await renderApp('/');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByRole('link', { name: 'Notifications, 0 unread' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it('checks once a minute, never in a hidden tab, and again when the user comes back', async () => {
    const { client } = await renderApp('/');
    const options = client.getQueryCache().find({ queryKey: notificationKeys.unreadCount })
      ?.observers[0]?.options;
    expect(options?.refetchInterval).toBe(UNREAD_POLL_MS);
    expect(UNREAD_POLL_MS).toBe(60_000);
    expect(options?.refetchIntervalInBackground).toBe(false);
    expect(options?.refetchOnWindowFocus).toBe(true);
  });

  it.each([
    ['de', 'Benachrichtigungen, 2 ungelesen'],
    ['bg', 'Известия, 2 непрочетени'],
  ] as const)('is labelled in %s', async (language, label) => {
    await initTestI18n(language);
    server.use(
      http.get(`${API}/notifications/unread-count`, () => HttpResponse.json({ unreadCount: 2 })),
    );
    await renderApp('/');
    expect(await screen.findByRole('link', { name: label })).toBeInTheDocument();
  });

  it('does not exist on the sign-in pages', async () => {
    server.use(
      http.get(`${API}/auth/me`, () => errorResponse('UNAUTHENTICATED', 401)),
      http.post(`${API}/auth/refresh`, () => errorResponse('UNAUTHENTICATED', 401)),
      http.get(`${API}/auth/providers`, () => HttpResponse.json({ google: false })),
    );
    await renderApp('/login');
    expect(screen.queryByRole('link', { name: /Notifications/ })).not.toBeInTheDocument();
  });
});

describe('notifications page', () => {
  it('shows an empty state', async () => {
    serve(() => list([]));
    await renderApp('/notifications');
    expect(await screen.findByText('You have no notifications yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  it('shows the text of a notification in the user’s language, with its time, and tells unread from read', async () => {
    serve(() =>
      list([
        item(2),
        item(1, { readAt: '2026-10-21T10:00:00.000Z', params: { roleNames: ['HR'] } }),
      ]),
    );
    await renderApp('/notifications');
    const entries = await screen.findAllByRole('listitem');
    expect(entries).toHaveLength(2);

    const unread = entries[0] as HTMLElement;
    expect(within(unread).getByText('Your roles were changed')).toBeInTheDocument();
    expect(within(unread).getByText('Your roles are now: HR and Manager.')).toBeInTheDocument();
    expect(within(unread).getByText('Unread')).toBeInTheDocument();
    expect(unread.querySelector('time')).toHaveAttribute('datetime', '2026-10-21T09:30:00.000Z');

    const read = entries[1] as HTMLElement;
    expect(within(read).getByText('Your roles are now: HR.')).toBeInTheDocument();
    expect(within(read).queryByText('Unread')).not.toBeInTheDocument();
  });

  it.each([
    [
      'de',
      'Ihre Rollen wurden geändert',
      'Ihre Rollen sind jetzt: HR und Manager.',
      'Alle als gelesen markieren',
    ],
    [
      'bg',
      'Ролите ви бяха променени',
      'Ролите ви вече са: HR и Manager.',
      'Маркирай всички като прочетени',
    ],
  ] as const)('is translated (%s)', async (language, title, text, markAll) => {
    await initTestI18n(language);
    serve(() => list([item(1)]));
    await renderApp('/notifications');
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: markAll })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/notifications:|types\.account/);
  });

  it('opening an unread notification marks it read; opening a read one does not call the server', async () => {
    const requests = serve(() => list([item(2), item(1, { readAt: '2026-10-21T10:00:00.000Z' })]));
    await renderApp('/notifications');
    const [unread, read] = await screen.findAllByRole('button', {
      name: /Your roles were changed/,
    });
    await userEvent.setup().click(read as HTMLElement);
    expect(requests.some((r) => r.path.startsWith('read:'))).toBe(false);
    await userEvent.setup().click(unread as HTMLElement);
    await waitFor(() => expect(requests.map((r) => r.path)).toContain(`read:${uuid(2)}`));
  });

  it('follows the notification’s link inside the app', async () => {
    serve(() => list([item(1, { link: '/leave' })]));
    const { router } = await renderApp('/notifications');
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: /Your roles were changed/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/leave'));
  });

  it.each(['https://evil.example/phish', '//evil.example', 'javascript:alert(1)'])(
    'never follows an unsafe link (%s)',
    async (link) => {
      serve(() => list([item(1, { link })]));
      const { router } = await renderApp('/notifications');
      await userEvent
        .setup()
        .click(await screen.findByRole('button', { name: /Your roles were changed/ }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/notifications'));
    },
  );

  it('"Mark all as read" calls the server and refreshes the list and the badge', async () => {
    let read = false;
    const requests: string[] = [];
    server.use(
      http.get(`${API}/notifications/unread-count`, () =>
        HttpResponse.json({ unreadCount: read ? 0 : 1 }),
      ),
      http.get(`${API}/notifications`, () =>
        HttpResponse.json(list([item(1, read ? { readAt: '2026-10-21T10:00:00.000Z' } : {})])),
      ),
      http.post(`${API}/notifications/read-all`, () => {
        requests.push('read-all');
        read = true;
        return HttpResponse.json({ updated: 1 });
      }),
    );
    await renderApp('/notifications');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Mark all as read' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled(),
    );
    expect(requests).toEqual(['read-all']);
    expect(
      await screen.findByRole('link', { name: 'Notifications, 0 unread' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Unread')).not.toBeInTheDocument();
  });

  it('pages through older notifications with a cursor', async () => {
    const requests = serve((before) =>
      before === null
        ? list([item(3), item(2)], { nextCursor: uuid(2), unreadCount: 3 })
        : list([item(1, { params: { roleNames: ['Employee'] } })], {
            nextCursor: null,
            unreadCount: 3,
          }),
    );
    await renderApp('/notifications');
    expect(await screen.findAllByRole('listitem')).toHaveLength(2);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show older' }));
    expect(await screen.findAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Your roles are now: Employee.')).toBeInTheDocument();
    expect(requests.filter((r) => r.path === 'list').map((r) => r.before)).toEqual([null, uuid(2)]);
    expect(screen.queryByRole('button', { name: 'Show older' })).not.toBeInTheDocument();
  });

  it('shows a generic text for a notification type this version does not know', async () => {
    serve(() => list([item(1, { type: 'future.thing', params: { anything: 1 } })]));
    await renderApp('/notifications');
    expect(await screen.findByText('New notification')).toBeInTheDocument();
    expect(screen.getByText('Open the app to see the details.')).toBeInTheDocument();
  });

  it('tolerates broken parameters without crashing', async () => {
    serve(() => list([item(1, { params: { roleNames: 'not-a-list' } })]));
    await renderApp('/notifications');
    expect(await screen.findByText('Your roles were changed')).toBeInTheDocument();
  });

  it('shows an error with a retry when loading fails', async () => {
    let up = false;
    server.use(
      http.get(`${API}/notifications`, () =>
        up ? HttpResponse.json(list([item(1)])) : errorResponse('INTERNAL_ERROR', 500),
      ),
    );
    await renderApp('/notifications');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side');
    up = true;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Your roles were changed')).toBeInTheDocument();
  });

  it('shows an error when marking as read fails, and keeps the list', async () => {
    server.use(
      http.get(`${API}/notifications`, () => HttpResponse.json(list([item(1)]))),
      http.post(`${API}/notifications/:id/read`, () => errorResponse('SERVICE_UNAVAILABLE', 503)),
    );
    await renderApp('/notifications');
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: /Your roles were changed/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable');
    expect(screen.getByText('Your roles were changed')).toBeInTheDocument();
  });

  it('links to the settings', async () => {
    serve(() => list([]));
    await renderApp('/notifications');
    expect(await screen.findByRole('link', { name: 'Notification settings' })).toHaveAttribute(
      'href',
      '/notifications/settings',
    );
  });

  it('is cleared from memory when the user signs out (a shared computer must not show it to the next person)', async () => {
    serve(() => list([item(1)]));
    server.use(http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 204 })));
    const { client, router } = await renderApp('/notifications');
    await screen.findByText('Your roles were changed');
    expect(client.getQueryData(notificationKeys.list)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(client.getQueryCache().findAll({ queryKey: notificationKeys.all })).toHaveLength(0);
  });
});

const preferences = (inApp: boolean) => [
  {
    type: 'account.roles_changed',
    channels: { in_app: { enabled: inApp, locked: false }, email: { enabled: true, locked: true } },
  },
];

describe('notification settings page', () => {
  it('shows each notification type with a switch per channel; required channels are on and cannot be changed', async () => {
    server.use(
      http.get(`${API}/notifications/preferences`, () => HttpResponse.json(preferences(true))),
    );
    await renderApp('/notifications/settings');
    expect(await screen.findByText('Changes to your roles')).toBeInTheDocument();
    const inApp = screen.getByRole('switch', { name: 'In the app: Changes to your roles' });
    const email = screen.getByRole('switch', { name: 'By email: Changes to your roles' });
    expect(inApp).toBeChecked();
    expect(inApp).toBeEnabled();
    expect(email).toBeChecked();
    expect(email).toBeDisabled();
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it('switching a channel sends exactly that change and shows the new state from the server', async () => {
    let inApp = true;
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API}/notifications/preferences`, () => HttpResponse.json(preferences(inApp))),
      http.put(`${API}/notifications/preferences`, async ({ request }) => {
        const body = (await request.json()) as { enabled: boolean };
        bodies.push(body);
        inApp = body.enabled;
        return HttpResponse.json(preferences(inApp)[0]);
      }),
    );
    await renderApp('/notifications/settings');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('switch', { name: 'In the app: Changes to your roles' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'In the app: Changes to your roles' }),
      ).not.toBeChecked(),
    );
    expect(bodies).toEqual([{ type: 'account.roles_changed', channel: 'in_app', enabled: false }]);

    await user.click(screen.getByRole('switch', { name: 'In the app: Changes to your roles' }));
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'In the app: Changes to your roles' }),
      ).toBeChecked(),
    );
    expect(bodies).toHaveLength(2);
  });

  it('never sends a change for a required channel', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API}/notifications/preferences`, () => HttpResponse.json(preferences(true))),
      http.put(`${API}/notifications/preferences`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(preferences(true)[0]);
      }),
    );
    await renderApp('/notifications/settings');
    await userEvent
      .setup()
      .click(await screen.findByRole('switch', { name: 'By email: Changes to your roles' }));
    expect(bodies).toEqual([]);
  });

  it('shows the error when saving fails and leaves the switch as it was', async () => {
    server.use(
      http.get(`${API}/notifications/preferences`, () => HttpResponse.json(preferences(true))),
      http.put(`${API}/notifications/preferences`, () => errorResponse('SERVICE_UNAVAILABLE', 503)),
    );
    await renderApp('/notifications/settings');
    await userEvent
      .setup()
      .click(await screen.findByRole('switch', { name: 'In the app: Changes to your roles' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable');
    expect(screen.getByRole('switch', { name: 'In the app: Changes to your roles' })).toBeChecked();
  });

  it('shows an error with a retry when the settings cannot be loaded', async () => {
    let up = false;
    server.use(
      http.get(`${API}/notifications/preferences`, () =>
        up ? HttpResponse.json(preferences(true)) : errorResponse('INTERNAL_ERROR', 500),
      ),
    );
    await renderApp('/notifications/settings');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    up = true;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Changes to your roles')).toBeInTheDocument();
  });

  it('is translated', async () => {
    await initTestI18n('de');
    server.use(
      http.get(`${API}/notifications/preferences`, () => HttpResponse.json(preferences(true))),
    );
    await renderApp('/notifications/settings');
    expect(await screen.findByText('Änderungen an Ihren Rollen')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'In der App: Änderungen an Ihren Rollen' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Erforderlich')).toBeInTheDocument();
  });

  it('is not available to someone without the permission (the inbox still is)', async () => {
    server.use(...signedInHandlers(userWithPermissions({})));
    serve(() => list([]));
    await renderApp('/notifications/settings');
    expect(screen.getByRole('heading', { level: 1, name: 'No access' })).toBeInTheDocument();
    await act(async () => {});
  });

  it('every system role can open it', async () => {
    for (const role of ['employee', 'admin'] as const) {
      server.use(...signedInHandlers(userWithRole(role)));
      server.use(
        http.get(`${API}/notifications/preferences`, () => HttpResponse.json(preferences(true))),
      );
      const { unmount } = await renderApp('/notifications/settings');
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Notification settings' }),
      ).toBeInTheDocument();
      unmount();
    }
  });
});
