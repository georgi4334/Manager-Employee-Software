import type { Employee, EmployeeList } from '@intime/contracts';
import { screen, waitFor, within } from '@testing-library/react';
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
import { openAccountMenu, renderApp } from '@/tests/utils';

const uuid = (n: number) => `0192f5a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const profile = (overrides: Partial<NonNullable<Employee['profile']>> = {}) => ({
  employeeNo: 'E-100',
  employmentType: 'full_time' as const,
  seniority: 'senior' as const,
  hireDate: '2024-01-15',
  terminationDate: null,
  birthDate: '1990-12-10',
  phone: '+359 88 123 4567',
  country: 'BG',
  accountStatus: 'active' as const,
  ...overrides,
});

const person = (n: number, overrides: Partial<Employee> = {}): Employee => ({
  id: uuid(n),
  firstName: 'Ada',
  lastName: 'Lovelace',
  jobTitle: 'Engineer',
  location: 'Sofia',
  email: 'ada@acme.eu',
  status: 'active',
  department: null,
  manager: null,
  teams: [],
  isSelf: false,
  profile: null,
  ...overrides,
});

const listOf = (items: Employee[], total = items.length): EmployeeList => ({
  items,
  total,
  page: 1,
  pageSize: 25,
});

const as = (role: 'hr' | 'employee' | 'manager' | 'admin') =>
  server.use(...signedInHandlers(userWithRole(role)));

function serveList(make: (url: URL) => EmployeeList) {
  const urls: URL[] = [];
  server.use(
    http.get(`${API}/employees`, ({ request }) => {
      const url = new URL(request.url);
      urls.push(url);
      return HttpResponse.json(make(url));
    }),
  );
  return urls;
}

describe('employee directory', () => {
  it('lists people with title, location and email, without management controls for employees', async () => {
    serveList(() =>
      listOf([
        person(1),
        person(2, {
          firstName: 'Me',
          lastName: 'Myself',
          isSelf: true,
          email: null,
          jobTitle: null,
        }),
      ]),
    );
    await renderApp('/employees');
    const list = await screen.findByRole('list', { name: 'Employee list' });
    expect(within(list).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(list).getByText('Engineer · Sofia')).toBeInTheDocument();
    expect(within(list).getByText('ada@acme.eu')).toBeInTheDocument();
    expect(within(list).getByText('You')).toBeInTheDocument();
    expect(screen.getByText('2 employees')).toBeInTheDocument();
    expect(within(list).getAllByRole('link')[0]).toHaveAttribute('href', `/employees/${uuid(1)}`);

    expect(screen.queryByRole('link', { name: 'Add employee' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Show' })).not.toBeInTheDocument();
  });

  it('shows HR the add button and the status filter and sends the chosen filter', async () => {
    as('hr');
    const urls = serveList(() => listOf([person(1)]));
    await renderApp('/employees');
    expect(await screen.findByRole('link', { name: 'Add employee' })).toHaveAttribute(
      'href',
      '/employees/new',
    );
    await userEvent
      .setup()
      .selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'inactive');
    await waitFor(() => expect(urls.at(-1)?.searchParams.get('status')).toBe('inactive'));
    expect(urls[0]?.searchParams.get('status')).toBe('active');
  });

  it('searches after typing stops and starts again from the first page', async () => {
    const urls = serveList((url) => listOf([person(1)], url.searchParams.get('q') ? 1 : 60));
    await renderApp('/employees');
    const user = userEvent.setup();
    await screen.findByText('60 employees');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(urls.at(-1)?.searchParams.get('page')).toBe('2'));

    await user.type(screen.getByRole('searchbox', { name: 'Search employees' }), ' lovelace ');
    await waitFor(() => expect(urls.at(-1)?.searchParams.get('q')).toBe('lovelace'));
    expect(urls.at(-1)?.searchParams.get('page')).toBe('1');
    // Typing does not send one request per keystroke.
    expect(urls.filter((u) => u.searchParams.get('q')).length).toBeLessThanOrEqual(2);
  });

  it('pages through long lists', async () => {
    serveList((url) => listOf([person(Number(url.searchParams.get('page')))], 60));
    await renderApp('/employees');
    const user = userEvent.setup();
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('says so when nobody matches and offers a retry when loading fails', async () => {
    serveList(() => listOf([]));
    await renderApp('/employees');
    expect(await screen.findByText('No employees found.')).toBeInTheDocument();

    let fail = true;
    server.use(
      http.get(`${API}/employees`, () =>
        fail ? errorResponse('INTERNAL_ERROR', 500) : HttpResponse.json(listOf([person(1)])),
      ),
    );
    const { unmount } = await renderApp('/employees');
    expect(await screen.findByText(/Something went wrong on our side/)).toBeInTheDocument();
    fail = false;
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Try again' })[0]!);
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    unmount();
  });

  it('is in German and Bulgarian', async () => {
    serveList(() => listOf([person(1)]));
    await initTestI18n('de');
    const { unmount } = await renderApp('/employees');
    expect(await screen.findByRole('heading', { name: 'Mitarbeitende' })).toBeInTheDocument();
    expect(screen.getByText('1 Mitarbeiter:in')).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/employees');
    expect(await screen.findByRole('heading', { name: 'Служители' })).toBeInTheDocument();
    expect(screen.getByText('1 служител')).toBeInTheDocument();
  });

  it('shows "no access" to someone without the directory permission', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    await renderApp('/employees');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });
});

describe('employee page', () => {
  const serveOne = (employee: Employee) => {
    server.use(http.get(`${API}/employees/${employee.id}`, () => HttpResponse.json(employee)));
  };

  it('shows the limited view when the profile is hidden and offers no actions', async () => {
    serveOne(person(1));
    await renderApp(`/employees/${uuid(1)}`);
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(
      screen.getByText('You can see the directory information of this person.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Date of birth')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });

  it('shows the full profile with locale-formatted dates', async () => {
    as('hr');
    serveOne(person(1, { profile: profile() }));
    await renderApp(`/employees/${uuid(1)}`);
    expect(await screen.findByText('Date of birth')).toBeInTheDocument();
    expect(screen.getByText('10 December 1990')).toBeInTheDocument();
    expect(screen.getByText('Senior')).toBeInTheDocument();
    expect(screen.getByText('+359 88 123 4567')).toBeInTheDocument();
    expect(screen.getByText('Full-time')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      `/employees/${uuid(1)}/edit`,
    );
  });

  it('says when the employee does not exist', async () => {
    server.use(http.get(`${API}/employees/${uuid(9)}`, () => errorResponse('NOT_FOUND', 404)));
    await renderApp(`/employees/${uuid(9)}`);
    expect(await screen.findByText('Employee not found')).toBeInTheDocument();
  });

  it('deactivates with a termination date after confirmation', async () => {
    as('hr');
    serveOne(person(1, { profile: profile() }));
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/employees/${uuid(1)}/deactivate`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(
          person(1, {
            status: 'inactive',
            profile: profile({ terminationDate: '2026-10-31', accountStatus: 'disabled' }),
          }),
        );
      }),
    );
    await renderApp(`/employees/${uuid(1)}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));
    const panel = screen.getByRole('group', { name: 'Deactivate Ada Lovelace?' });
    await user.type(within(panel).getByLabelText('Termination date'), '2026-10-31');
    await user.click(within(panel).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(bodies).toEqual([{ terminationDate: '2026-10-31' }]));
    expect(await screen.findByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByText('31 October 2026')).toBeInTheDocument();
  });

  it('sends no date when the field is empty and shows API errors', async () => {
    as('hr');
    serveOne(person(1, { profile: profile() }));
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/employees/${uuid(1)}/deactivate`, async ({ request }) => {
        bodies.push(await request.json());
        return errorResponse('LAST_ADMIN', 409);
      }),
    );
    await renderApp(`/employees/${uuid(1)}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await user.click(within(screen.getByRole('group')).getByRole('button', { name: 'Deactivate' }));
    expect(
      await screen.findByText('There must always be at least one active administrator.'),
    ).toBeInTheDocument();
    expect(bodies).toEqual([{}]);
  });

  it('does not offer to deactivate yourself, but reactivates others', async () => {
    as('hr');
    serveOne(person(1, { isSelf: true, profile: profile() }));
    const { unmount } = await renderApp(`/employees/${uuid(1)}`);
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    unmount();

    serveOne(
      person(2, { status: 'inactive', profile: profile({ terminationDate: '2026-01-01' }) }),
    );
    server.use(
      http.post(`${API}/employees/${uuid(2)}/reactivate`, () =>
        HttpResponse.json(person(2, { profile: profile() })),
      ),
    );
    await renderApp(`/employees/${uuid(2)}`);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Reactivate' }));
    expect(await screen.findByText('Employee reactivated.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
  });

  it('invites an employee without an account and re-sends an open invitation', async () => {
    as('hr');
    serveOne(person(1, { email: null, profile: profile({ accountStatus: null }) }));
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/employees/${uuid(1)}/invitation`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(
          person(1, { email: 'ada@acme.eu', profile: profile({ accountStatus: 'invited' }) }),
        );
      }),
    );
    await renderApp(`/employees/${uuid(1)}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Invite to sign in' }));
    // A wrong address is caught before anything is sent.
    await user.type(screen.getByLabelText('Email address'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(bodies).toEqual([]);

    await user.clear(screen.getByLabelText('Email address'));
    await user.type(screen.getByLabelText('Email address'), 'ada@acme.eu');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText('Invitation sent.')).toBeInTheDocument();
    expect(bodies).toEqual([{ email: 'ada@acme.eu' }]);

    // The address is now fixed; the same button re-sends.
    await user.click(screen.getByRole('button', { name: 'Resend invitation' }));
    expect(screen.getByLabelText('Email address')).toHaveAttribute('readonly');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(bodies).toEqual([{ email: 'ada@acme.eu' }, {}]));
  });

  it('offers no invitation for people with an active account', async () => {
    as('hr');
    serveOne(person(1, { profile: profile() }));
    await renderApp(`/employees/${uuid(1)}`);
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    expect(screen.queryByRole('button', { name: /nvit/ })).not.toBeInTheDocument();
  });
});

describe('employee form', () => {
  it('is only for people who may create employees', async () => {
    await renderApp('/employees/new');
    expect(await screen.findByText('No access')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'First name' })).not.toBeInTheDocument();
  });

  it('validates before sending, then creates and opens the new employee', async () => {
    as('hr');
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/employees`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(person(7, { firstName: 'Grace', lastName: 'Hopper' }), {
          status: 201,
        });
      }),
      http.get(`${API}/employees/${uuid(7)}`, () =>
        HttpResponse.json(person(7, { firstName: 'Grace', lastName: 'Hopper' })),
      ),
    );
    const { router } = await renderApp('/employees/new');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Create employee' }));
    expect(await screen.findAllByText('This field is required.')).toHaveLength(2);
    expect(bodies).toEqual([]);

    await user.type(screen.getByLabelText('First name'), 'Grace');
    await user.type(screen.getByLabelText('Last name'), 'Hopper');
    await user.type(screen.getByLabelText('Email'), ' Grace@Acme.EU ');
    await user.type(screen.getByLabelText('Country'), 'de');
    await user.selectOptions(screen.getByLabelText('Seniority'), 'lead');
    await user.click(screen.getByRole('button', { name: 'Create employee' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/employees/${uuid(7)}`));
    expect(bodies).toEqual([
      {
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@acme.eu',
        employmentType: 'full_time',
        seniority: 'lead',
        country: 'de',
      },
    ]);
  });

  it('shows which field clashes when the API reports a conflict', async () => {
    as('hr');
    server.use(
      http.post(`${API}/employees`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'employeeNo' } }),
      ),
    );
    const { router } = await renderApp('/employees/new');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('First name'), 'Grace');
    await user.type(screen.getByLabelText('Last name'), 'Hopper');
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    expect(await screen.findByText('This employee number is already in use.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/employees/new');
  });

  it('edits an employee: prefilled, sends cleared values as null, no email field', async () => {
    as('hr');
    const existing = person(1, { profile: profile() });
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.get(`${API}/employees/${uuid(1)}`, () => HttpResponse.json(existing)),
      http.patch(`${API}/employees/${uuid(1)}`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(existing);
      }),
    );
    const { router } = await renderApp(`/employees/${uuid(1)}/edit`);
    const user = userEvent.setup();
    expect(await screen.findByLabelText('First name')).toHaveValue('Ada');
    expect(screen.getByLabelText('Job title')).toHaveValue('Engineer');
    expect(screen.getByLabelText('Seniority')).toHaveValue('senior');
    expect(screen.getByLabelText('Hire date')).toHaveValue('2024-01-15');
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Job title'));
    await user.clear(screen.getByLabelText('Phone'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/employees/${uuid(1)}`));
    expect(bodies[0]).toMatchObject({
      jobTitle: null,
      phone: null,
      firstName: 'Ada',
      seniority: 'senior',
    });
  });

  it('refuses to edit people whose profile the user cannot see', async () => {
    as('hr');
    server.use(http.get(`${API}/employees/${uuid(1)}`, () => HttpResponse.json(person(1))));
    await renderApp(`/employees/${uuid(1)}/edit`);
    expect(
      await screen.findByText('You can only edit people whose full profile you can see.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });
});

describe('my profile', () => {
  it('shows the own record and saves a new phone number', async () => {
    const own = person(3, { isSelf: true, profile: profile() });
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API}/employees/me`, () => HttpResponse.json(own)),
      http.patch(`${API}/employees/me`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(
          person(3, { isSelf: true, profile: profile({ phone: '+49 30 1234567' }) }),
        );
      }),
    );
    await renderApp('/profile');
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toHaveValue('+359 88 123 4567');

    await user.clear(screen.getByLabelText('Phone'));
    await user.type(screen.getByLabelText('Phone'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a valid phone number.')).toBeInTheDocument();
    expect(bodies).toEqual([]);

    await user.clear(screen.getByLabelText('Phone'));
    await user.type(screen.getByLabelText('Phone'), '+49 30 1234567');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(bodies).toEqual([{ phone: '+49 30 1234567' }]);
  });

  it('explains a missing employee record', async () => {
    server.use(http.get(`${API}/employees/me`, () => errorResponse('NOT_FOUND', 404)));
    await renderApp('/profile');
    expect(await screen.findByText(/no employee record for your account/)).toBeInTheDocument();
  });

  it('hides the phone form without the permission and is reachable from the profile drawer', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'employee.view_directory': 'all' })),
      http.get(`${API}/employees/me`, () =>
        HttpResponse.json(person(3, { isSelf: true, profile: profile() })),
      ),
    );
    await renderApp('/profile');
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect((await openAccountMenu()).getByRole('link', { name: 'Profile' })).toHaveAttribute(
      'href',
      '/profile',
    );
  });

  it('forgets employee data when signing out', async () => {
    server.use(
      http.get(`${API}/employees/me`, () =>
        HttpResponse.json(person(3, { isSelf: true, profile: profile() })),
      ),
    );
    const { client, router } = await renderApp('/profile');
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    server.use(http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 204 })));
    await userEvent
      .setup()
      .click((await openAccountMenu()).getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(client.getQueryCache().findAll({ queryKey: ['employees'] })).toHaveLength(0);
  });
});
