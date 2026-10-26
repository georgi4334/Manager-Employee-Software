import type { GrantedPermissions } from '@intime/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { initTestI18n } from '@/tests/i18n';
import { server, signedInHandlers, userWithPermissions, userWithRole } from '@/tests/server';
import { renderApp } from '@/tests/utils';
import { Can } from './Can';
import { userHasPermission } from './permissions';
import { Providers } from '@/app/providers';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

describe('userHasPermission', () => {
  const granted: GrantedPermissions = { 'leave.view': 'team', 'leave.request': 'own' };

  it('is true for a held permission and false for anything else', () => {
    expect(userHasPermission(granted, 'leave.request')).toBe(true);
    expect(userHasPermission(granted, 'leave.approve')).toBe(false);
  });

  it('with several permissions, any one is enough', () => {
    expect(userHasPermission(granted, ['leave.approve', 'leave.request'])).toBe(true);
    expect(userHasPermission(granted, ['leave.approve', 'admin.user.view'])).toBe(false);
    expect(userHasPermission(granted, [])).toBe(false);
  });

  it('compares scopes when asked', () => {
    expect(userHasPermission(granted, 'leave.view', 'reports')).toBe(true);
    expect(userHasPermission(granted, 'leave.view', 'all')).toBe(false);
    expect(userHasPermission(granted, 'leave.request', 'team')).toBe(false);
  });

  it('denies when nothing is known about the user', () => {
    expect(userHasPermission(undefined, 'leave.request')).toBe(false);
    expect(userHasPermission({}, 'leave.request')).toBe(false);
  });

  it('fails closed on unknown scopes sent by a faulty server', () => {
    const corrupted = {
      'leave.request': 'galaxy',
      'made.up': 'all',
    } as unknown as GrantedPermissions;
    expect(userHasPermission(corrupted, 'leave.request')).toBe(false);
  });
});

function renderCan(user: ReturnType<typeof userWithRole>, ui: React.ReactElement) {
  server.use(...signedInHandlers(user));
  return render(
    <Providers>
      <MemoryRouter>{ui}</MemoryRouter>
    </Providers>,
  );
}

describe('<Can>', () => {
  it('shows its content to users with the permission', async () => {
    renderCan(
      userWithRole('hr'),
      <Can permission="admin.user.invite">
        <button>Invite user</button>
      </Can>,
    );
    expect(await screen.findByRole('button', { name: 'Invite user' })).toBeInTheDocument();
  });

  it('hides it from users without the permission, and shows the fallback if given', async () => {
    renderCan(
      userWithRole('employee'),
      <>
        <Can permission="admin.user.invite">
          <button>Invite user</button>
        </Can>
        <Can permission="admin.user.invite" fallback={<p>Ask HR</p>}>
          <button>Invite user</button>
        </Can>
      </>,
    );
    // The permission-less user is signed in, but nothing admin-like is rendered.
    expect(await screen.findByText('Ask HR')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite user' })).not.toBeInTheDocument();
  });

  it('respects the required scope', async () => {
    renderCan(
      userWithRole('manager'),
      <>
        <Can permission="leave.approve" atLeast="reports">
          <p>Approve (reports)</p>
        </Can>
        <Can permission="leave.approve" atLeast="all">
          <p>Approve (everyone)</p>
        </Can>
      </>,
    );
    expect(await screen.findByText('Approve (reports)')).toBeInTheDocument();
    expect(screen.queryByText('Approve (everyone)')).not.toBeInTheDocument();
  });
});

const sidebarLinks = () =>
  within(screen.getByRole('navigation', { name: 'Main navigation' }))
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('navigation by permission', () => {
  it.each(['employee', 'manager', 'hr', 'admin'] as const)(
    'a %s sees every module the role has access to',
    async (role) => {
      server.use(...signedInHandlers(userWithRole(role)));
      await renderApp('/');
      expect(sidebarLinks()).toEqual([
        'Dashboard',
        'Attendance',
        'Leave',
        'Calendar',
        'Projects',
        'Tasks',
        'Time',
        'Capacity',
        'Goals',
        '1:1 meetings',
        'Feedback',
        'Skills',
        'Reviews',
        ...(role === 'employee' ? [] : ['Analytics']),
        'Assistant',
        'Employees',
        'Organization',
      ]);
    },
  );

  it('shows only what a limited role (e.g. an outsourced contractor) may use', async () => {
    server.use(
      ...signedInHandlers(
        userWithPermissions({ 'attendance.record': 'own', 'calendar.manage_own': 'own' }),
      ),
    );
    await renderApp('/');
    expect(sidebarLinks()).toEqual(['Dashboard', 'Attendance', 'Calendar']);
  });

  it('one of several permissions is enough to see an entry', async () => {
    server.use(...signedInHandlers(userWithPermissions({ 'leave.view': 'own' })));
    await renderApp('/');
    expect(sidebarLinks()).toEqual(['Dashboard', 'Leave']);
  });

  it('a user without any permission sees only the dashboard, and no empty "More" menu', async () => {
    server.use(...signedInHandlers(userWithPermissions({})));
    await renderApp('/');
    expect(sidebarLinks()).toEqual(['Dashboard']);
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('the mobile bar and "More" menu follow the same rules', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'org.view': 'all', 'attendance.record': 'own' })),
    );
    await renderApp('/');
    const bar = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(
      within(bar)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Dashboard', 'Attendance']);
    await userEvent.setup().click(screen.getByRole('button', { name: 'More' }));
    const more = screen.getByRole('dialog', { name: 'More navigation' });
    expect(
      within(more)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Organization']);
  });
});

describe('route protection (cosmetic; the API is the authority)', () => {
  it('opens a module the user may use', async () => {
    server.use(...signedInHandlers(userWithPermissions({ 'attendance.record': 'own' })));
    await renderApp('/attendance');
    expect(screen.getByRole('heading', { level: 1, name: 'Attendance' })).toBeInTheDocument();
  });

  it('shows "No access" instead of a module the user may not use, even when typing the address', async () => {
    server.use(...signedInHandlers(userWithPermissions({ 'attendance.record': 'own' })));
    await renderApp('/employees');
    expect(screen.getByRole('heading', { level: 1, name: 'No access' })).toBeInTheDocument();
    expect(screen.getByText(/do not have permission/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Employees' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  });

  it('keeps the app shell around the "No access" page so the user can navigate away', async () => {
    server.use(...signedInHandlers(userWithPermissions({ 'attendance.record': 'own' })));
    await renderApp('/organization');
    expect(screen.getByRole('heading', { level: 1, name: 'No access' })).toBeInTheDocument();
    await userEvent.setup().click(
      within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', {
        name: 'Attendance',
      }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Attendance' }),
    ).toBeInTheDocument();
  });

  it('every system role can open every current module', async () => {
    for (const role of ['employee', 'admin'] as const) {
      server.use(...signedInHandlers(userWithRole(role)));
      const { unmount } = await renderApp('/organization');
      expect(screen.getByRole('heading', { level: 1, name: 'Organization' })).toBeInTheDocument();
      unmount();
    }
  });
});

describe('who is signed in', () => {
  it('shows the role names next to the workspace', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    await renderApp('/');
    expect(within(screen.getByRole('banner')).getByText('Acme GmbH · Admin')).toBeInTheDocument();
  });

  it.each([
    ['de', 'Kein Zugriff'],
    ['bg', 'Няма достъп'],
  ] as const)('the no-access page is translated (%s)', async (language, title) => {
    await initTestI18n(language);
    server.use(...signedInHandlers(userWithPermissions({})));
    await renderApp('/leave');
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/errors:|forbidden(Title|Text)/);
  });
});
