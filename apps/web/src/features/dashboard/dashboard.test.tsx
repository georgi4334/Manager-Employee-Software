import type { DashboardLayout, GrantedPermissions } from '@intime/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  API,
  errorResponse,
  server,
  signedInHandlers,
  userWithPermissions,
  userWithRole,
} from '@/tests/server';
import { renderApp } from '@/tests/utils';

function dashboard(layout: Partial<DashboardLayout>, permissions?: GrantedPermissions) {
  const state = {
    layout: { widgets: [], isDefault: false, canEdit: false, ...layout } as DashboardLayout,
    puts: [] as unknown[],
    deletes: 0,
  };
  server.use(
    ...signedInHandlers(permissions ? userWithPermissions(permissions) : userWithRole('admin')),
  );
  server.use(
    http.get(`${API}/dashboard/layout`, () => HttpResponse.json(state.layout)),
    http.put(`${API}/dashboard/layout`, async ({ request }) => {
      const body = (await request.json()) as { widgets: DashboardLayout['widgets'] };
      state.puts.push(body);
      state.layout = { ...state.layout, widgets: body.widgets, isDefault: false };
      return HttpResponse.json(state.layout);
    }),
    http.delete(`${API}/dashboard/layout`, () => {
      state.deletes++;
      state.layout = { ...state.layout, widgets: ['notifications'], isDefault: true };
      return HttpResponse.json(state.layout);
    }),
    http.get(`${API}/notifications`, () =>
      HttpResponse.json({ items: [], unreadCount: 0, nextCursor: null }),
    ),
    http.get(`${API}/roles`, () =>
      HttpResponse.json([
        {
          id: 'r1',
          key: 'admin',
          name: 'Admin',
          isSystem: true,
          description: null,
          permissionCount: 70,
          userCount: 2,
        },
      ]),
    ),
    http.get(`${API}/org/departments`, () => HttpResponse.json([{ id: 'd1' }, { id: 'd2' }])),
    http.get(`${API}/org/teams`, () => HttpResponse.json([{ id: 't1' }])),
  );
  return state;
}

const widgetList = () => screen.getByRole('list', { name: 'Dashboard' });

describe('dashboard', () => {
  it('shows only the widgets the person may use, and no editing without the right', async () => {
    dashboard({ widgets: ['roles', 'notifications', 'organization'] }, {});
    await renderApp('/');
    const list = widgetList();
    expect(
      await within(list).findByRole('heading', { name: 'Latest notifications' }),
    ).toBeInTheDocument();
    expect(within(list).queryByRole('heading', { name: 'Roles' })).not.toBeInTheDocument();
    expect(within(list).queryByRole('heading', { name: 'Organization' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument();
    expect(await screen.findByText('No notifications.')).toBeInTheDocument();
  });

  it('shows data in the widgets', async () => {
    dashboard({ widgets: ['roles', 'organization'], canEdit: true });
    await renderApp('/');
    const list = widgetList();
    expect(await within(list).findByText('2 people')).toBeInTheDocument();
    expect(within(list).getByText('Departments').closest('li')).toHaveTextContent('2');
    expect(within(list).getAllByRole('link', { name: 'View all' })).toHaveLength(2);
  });

  it('a figure card shows the value, a note and a trend line, and links to its page', async () => {
    dashboard({ widgets: ['stat_hours'] }, { 'time.log': 'own' });
    server.use(
      http.get(`${API}/time/week`, () =>
        HttpResponse.json({
          weekStart: '2026-10-26',
          employee: { id: 'e1', firstName: 'Maria', lastName: 'K' },
          status: null,
          timesheetId: null,
          entries: [],
          days: [
            { date: '2026-10-26', minutes: 480 },
            { date: '2026-10-27', minutes: 450 },
            { date: '2026-10-28', minutes: 0 },
          ],
          totalMinutes: 930,
          billableMinutes: 600,
          canSubmit: true,
        }),
      ),
    );
    const { container } = await renderApp('/');
    const card = await screen.findByRole('link', { name: /My hours this week/ });
    expect(card).toHaveAttribute('href', '/time');
    expect(await within(card).findByText('15:30')).toBeInTheDocument();
    expect(within(card).getByText('10:00 billable')).toBeInTheDocument();
    expect(container.querySelector('svg polyline')).not.toBeNull();
  });

  it('says so when nothing is on the dashboard', async () => {
    dashboard({ widgets: [] }, {});
    await renderApp('/');
    expect(await screen.findByText('Nothing to show here yet.')).toBeInTheDocument();
  });

  it('shows an error when the layout cannot be loaded', async () => {
    dashboard({}, {});
    server.use(http.get(`${API}/dashboard/layout`, () => errorResponse('INTERNAL', 500)));
    await renderApp('/');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('lets an administrator move, remove and add widgets and save', async () => {
    const state = dashboard({ widgets: ['roles', 'organization', 'notifications'], canEdit: true });
    await renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Customize' }));
    expect(screen.getByRole('button', { name: 'Move Roles up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Latest notifications down' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move Roles down' }));
    await user.click(screen.getByRole('button', { name: 'Remove Latest notifications' }));
    await user.click(screen.getByRole('button', { name: 'Add People' }));
    await user.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() =>
      expect(state.puts).toEqual([{ widgets: ['organization', 'roles', 'employees'] }]),
    );
    expect(screen.queryByRole('button', { name: 'Save layout' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Customize' })).toBeInTheDocument();
  });

  it('cancel keeps the stored layout', async () => {
    const state = dashboard({ widgets: ['roles', 'organization'], canEdit: true });
    await renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Customize' }));
    await user.click(screen.getByRole('button', { name: 'Remove Roles' }));
    expect(within(widgetList()).queryByRole('heading', { name: 'Roles' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await within(widgetList()).findByRole('heading', { name: 'Roles' })).toBeInTheDocument();
    expect(state.puts).toEqual([]);
  });

  it('reset goes back to the default', async () => {
    const state = dashboard({ widgets: ['roles'], canEdit: true });
    await renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Customize' }));
    await user.click(screen.getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => expect(state.deletes).toBe(1));
    expect(
      await within(widgetList()).findByRole('heading', { name: 'Latest notifications' }),
    ).toBeInTheDocument();
    expect(within(widgetList()).queryByRole('heading', { name: 'Roles' })).not.toBeInTheDocument();
  });

  it('while editing, a widget the administrator cannot use is a placeholder, not hidden', async () => {
    dashboard({ widgets: ['roles'], canEdit: true }, { 'admin.tenant.settings': 'all' });
    await renderApp('/');
    expect(within(widgetList()).queryByRole('heading', { name: 'Roles' })).not.toBeInTheDocument();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Customize' }));
    expect(within(widgetList()).getByRole('heading', { name: 'Roles' })).toBeInTheDocument();
    expect(screen.getByText(/You do not have access to this widget/)).toBeInTheDocument();
  });

  it('when every widget is placed, the add list says so', async () => {
    const { DASHBOARD_WIDGETS } = await import('@intime/contracts');
    dashboard(
      { widgets: [...DASHBOARD_WIDGETS], canEdit: true },
      { 'admin.tenant.settings': 'all' },
    );
    await renderApp('/');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Customize' }));
    expect(screen.getByText('Every widget is already on the dashboard.')).toBeInTheDocument();
  });

  it('shows the server answer when saving fails', async () => {
    dashboard({ widgets: ['roles'], canEdit: true });
    server.use(http.put(`${API}/dashboard/layout`, () => errorResponse('FORBIDDEN', 403)));
    await renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Customize' }));
    await user.click(screen.getByRole('button', { name: 'Save layout' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save layout' })).toBeInTheDocument();
  });
});
