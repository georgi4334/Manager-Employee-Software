import type {
  Assignment,
  Client,
  Employee,
  Milestone,
  ProjectDetail,
  ProjectSummary,
} from '@intime/contracts';
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
import { renderApp } from '@/tests/utils';

const uuid = (n: number) => `0192f5a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const P1 = uuid(1);
const LEAD = { id: uuid(60), firstName: 'Mia', lastName: 'Manager' };

const summary = (n: number, o: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: uuid(n),
  code: `P-${n}`,
  name: `Project ${n}`,
  client: { id: uuid(40), name: 'Initech' },
  status: 'active',
  priority: 'normal',
  isBillable: true,
  budgetHours: null,
  startDate: '2026-01-05',
  endDate: null,
  lead: LEAD,
  health: 'on_track',
  canEdit: true,
  canStaff: true,
  ...o,
});

const milestone = (n: number, o: Partial<Milestone> = {}): Milestone => ({
  id: uuid(300 + n),
  title: `Milestone ${n}`,
  dueDate: '2026-03-01',
  status: 'open',
  doneOn: null,
  overdueDays: 0,
  ...o,
});

const assignment = (n: number, o: Partial<Assignment> = {}): Assignment => ({
  id: uuid(400 + n),
  employee: { id: uuid(70 + n), firstName: `Person${n}`, lastName: 'Test' },
  role: 'Backend',
  allocationPct: 50,
  fromDate: '2026-02-02',
  toDate: null,
  overAllocated: false,
  ...o,
});

const detail = (o: Partial<ProjectDetail> = {}): ProjectDetail => ({
  ...summary(1),
  description: null,
  milestones: [],
  assignments: [],
  ...o,
});

const client = (n: number, o: Partial<Client> = {}): Client => ({
  id: uuid(40 + n),
  name: `Client ${n}`,
  contactName: null,
  contactEmail: null,
  notes: null,
  status: 'active',
  projectCount: 0,
  ...o,
});

const people = (names: string[]): Employee[] =>
  names.map((name, i) => ({
    id: uuid(90 + i),
    firstName: name,
    lastName: 'Test',
    jobTitle: null,
    location: null,
    email: null,
    status: 'active',
    department: null,
    manager: null,
    teams: [],
    isSelf: false,
    profile: null,
  }));

interface Served {
  projects?: ProjectSummary[];
  project?: ProjectDetail;
  clients?: Client[];
  people?: Employee[];
}

function serve(o: Served = {}) {
  const calls = { projects: [] as URL[], employees: [] as URL[] };
  server.use(
    http.get(`${API}/projects`, ({ request }) => {
      calls.projects.push(new URL(request.url));
      const items = o.projects ?? [];
      return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 25 });
    }),
    http.get(`${API}/projects/${P1}`, () =>
      o.project ? HttpResponse.json(o.project) : errorResponse('NOT_FOUND', 404),
    ),
    http.get(`${API}/clients`, () => HttpResponse.json({ items: o.clients ?? [] })),
    http.get(`${API}/employees`, ({ request }) => {
      calls.employees.push(new URL(request.url));
      const items = o.people ?? [];
      return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 25 });
    }),
  );
  return calls;
}
const as = (role: 'employee' | 'manager' | 'hr') =>
  server.use(...signedInHandlers(userWithRole(role)));

// ---------------------------------------------------------------------------------------------------
describe('access and structure', () => {
  it('is not for people without a project permission', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    await renderApp('/projects');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('gives employees the list only: no clients, no creating', async () => {
    serve({ projects: [summary(1)] });
    await renderApp('/projects');
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(await screen.findByText('Project 1')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Client')).not.toBeInTheDocument();
  });

  it('gives managers and HR the clients tab and a way to create projects', async () => {
    for (const role of ['manager', 'hr'] as const) {
      as(role);
      serve();
      const { unmount } = await renderApp('/projects');
      expect((await screen.findAllByRole('tab')).map((tab) => tab.textContent)).toEqual([
        'Projects',
        'Clients',
      ]);
      expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument();
      unmount();
    }
  });

  it('is in German and Bulgarian', async () => {
    serve({ projects: [summary(1)] });
    await initTestI18n('de');
    const { unmount } = await renderApp('/projects');
    expect(await screen.findByRole('heading', { name: 'Projekte' })).toBeInTheDocument();
    expect(await screen.findByText('Im Plan')).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/projects');
    expect(await screen.findByRole('heading', { name: 'Проекти' })).toBeInTheDocument();
    expect(await screen.findByText('По план')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the list', () => {
  it('shows code, client, lead, period and health in words', async () => {
    as('hr');
    serve({
      projects: [
        summary(1, { endDate: '2026-12-31', health: 'at_risk' }),
        summary(2, { health: null, status: 'paused', client: null, lead: null }),
        summary(3, { health: 'off_track' }),
      ],
    });
    await renderApp('/projects');
    const list = await screen.findByRole('list', { name: 'Projects' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('P-1 · Initech');
    expect(rows[0]).toHaveTextContent('Lead: Mia Manager');
    expect(rows[0]).toHaveTextContent('At risk');
    expect(rows[1]).toHaveTextContent('No lead');
    expect(rows[1]).toHaveTextContent('Paused'); // no health: the status instead
    expect(rows[2]).toHaveTextContent('Off track');
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute('href', `/projects/${uuid(1)}`);
    expect(screen.getByText('3 projects')).toBeInTheDocument();
  });

  it('searches, filters by status and client, and starts again on page 1', async () => {
    as('hr');
    const calls = serve({ clients: [client(1)] });
    await renderApp('/projects');
    const user = userEvent.setup();
    await screen.findByText('No projects to show.');
    await user.type(screen.getByLabelText('Search by name or code'), 'web');
    await waitFor(() => expect(calls.projects.at(-1)!.searchParams.get('q')).toBe('web'));
    await user.selectOptions(screen.getByLabelText('Status'), 'Paused');
    await waitFor(() => expect(calls.projects.at(-1)!.searchParams.get('status')).toBe('paused'));
    await screen.findByRole('option', { name: 'Client 1' });
    await user.selectOptions(screen.getByLabelText('Client'), 'Client 1');
    await waitFor(() => expect(calls.projects.at(-1)!.searchParams.get('clientId')).toBe(uuid(41)));
    expect(calls.projects.at(-1)!.searchParams.get('page')).toBe('1');
  });

  it('pages through long lists', async () => {
    serve();
    const urls: URL[] = [];
    server.use(
      http.get(`${API}/projects`, ({ request }) => {
        const url = new URL(request.url);
        urls.push(url);
        const page = Number(url.searchParams.get('page'));
        return HttpResponse.json({ items: [summary(page)], total: 30, page, pageSize: 25 });
      }),
    );
    await renderApp('/projects');
    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();
    expect(urls.at(-1)!.searchParams.get('page')).toBe('2');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('shows the API error with a retry', async () => {
    serve();
    server.use(http.get(`${API}/projects`, () => errorResponse('INTERNAL_ERROR', 500)));
    await renderApp('/projects');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('creating a project', () => {
  const open = async () => {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New project' }));
    return { user, form: within(await screen.findByRole('form', { name: 'New project' })) };
  };

  it('checks the form before sending anything', async () => {
    as('hr');
    serve();
    const bodies: unknown[] = [];
    server.use(
      http.post(
        `${API}/projects`,
        async ({ request }) => (
          bodies.push(await request.json()),
          HttpResponse.json(detail(), { status: 201 })
        ),
      ),
    );
    await renderApp('/projects');
    const { user, form } = await open();
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Use 2 to 12 letters, digits or dashes.')).toBeInTheDocument();
    expect(screen.getByText('This field is required.')).toBeInTheDocument(); // the name
    await user.type(form.getByLabelText('Code'), 'web-1');
    await user.type(form.getByLabelText('Name'), 'Website');
    await user.type(form.getByLabelText('Budget in hours (optional)'), '10.3');
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Use whole or half hours.')).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('sends the project with the chosen client and lead and opens it', async () => {
    as('hr');
    serve({ clients: [client(1)], people: people(['Lena', 'Lars']) });
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/projects`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(detail(), { status: 201 });
      }),
    );
    const { router } = await renderApp('/projects');
    const { user, form } = await open();
    await user.type(form.getByLabelText('Code'), 'web-1');
    await user.type(form.getByLabelText('Name'), ' Website ');
    await form.findByRole('option', { name: 'Client 1' });
    await user.selectOptions(form.getByLabelText('Client'), 'Client 1');
    await user.selectOptions(form.getByLabelText('Status'), 'Active');
    await user.type(form.getByLabelText('Budget in hours (optional)'), '120.5');
    await form.findByRole('option', { name: 'Lena Test' });
    await user.selectOptions(form.getByLabelText('Project lead'), 'Lena Test');
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      code: 'web-1',
      name: 'Website',
      clientId: uuid(41),
      status: 'active',
      budgetHours: 120.5,
      isBillable: true,
      leadEmployeeId: uuid(90),
    });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${P1}`));
  });

  it('tells managers they will lead the project and offers no lead picker', async () => {
    as('manager');
    serve();
    await renderApp('/projects');
    const { form } = await open();
    expect(form.getByText('You will be the project lead.')).toBeInTheDocument();
    expect(form.queryByLabelText('Project lead')).not.toBeInTheDocument();
  });

  it.each([
    ['CONFLICT', 409, { params: { field: 'code' } }, 'This project code is already in use.'],
    [
      'VALIDATION_FAILED',
      400,
      { details: [{ path: 'clientId', code: 'unknown_client', message: 'x' }] },
      'This client does not exist.',
    ],
    ['FORBIDDEN', 403, {}, 'You are not allowed to do this.'],
  ] as const)('shows the server answer %s', async (code, status, extra, text) => {
    as('hr');
    serve();
    server.use(http.post(`${API}/projects`, () => errorResponse(code, status, extra)));
    await renderApp('/projects');
    const { user, form } = await open();
    await user.type(form.getByLabelText('Code'), 'web-1');
    await user.type(form.getByLabelText('Name'), 'Website');
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the project page', () => {
  it('shows the overview and offers editing only when the server says so', async () => {
    as('hr');
    serve({
      project: detail({
        description: 'The new site',
        budgetHours: 120.5,
        endDate: '2026-12-31',
        priority: 'high',
      }),
    });
    const first = await renderApp(`/projects/${P1}`);
    expect(await screen.findByRole('heading', { name: 'Project 1' })).toBeInTheDocument();
    expect(screen.getByText('P-1 · Initech')).toBeInTheDocument();
    expect(screen.getByText('The new site')).toBeInTheDocument();
    expect(screen.getByText('120.5 h')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit project' })).toBeInTheDocument();
    first.unmount();
    as('employee');
    serve({ project: detail({ canEdit: false, canStaff: false }) });
    await renderApp(`/projects/${P1}`);
    await screen.findByRole('heading', { name: 'Project 1' });
    expect(screen.queryByRole('button', { name: 'Edit project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add milestone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add person' })).not.toBeInTheDocument();
  });

  it('says so when the project does not exist or is not visible', async () => {
    serve();
    await renderApp(`/projects/${P1}`);
    expect(await screen.findByText('Project not found')).toBeInTheDocument();
  });

  it('edits the project and sends only what changed', async () => {
    as('manager');
    serve({ project: detail({ name: 'Old name', endDate: '2026-12-31' }) });
    const bodies: unknown[] = [];
    server.use(
      http.patch(
        `${API}/projects/${P1}`,
        async ({ request }) => (bodies.push(await request.json()), HttpResponse.json(detail())),
      ),
    );
    await renderApp(`/projects/${P1}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit project' }));
    const form = within(screen.getByRole('form', { name: 'Change project' }));
    expect(form.queryByLabelText('Project lead')).not.toBeInTheDocument(); // managers cannot reassign the lead
    const name = form.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'New name');
    await user.clear(form.getByLabelText('End date (optional)'));
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toEqual([{ name: 'New name', endDate: null }]));
  });

  it('describes the timeline in words: not started, running and ended', async () => {
    as('hr');
    serve({ project: detail({ startDate: '2999-01-01', endDate: '2999-12-31' }) });
    const first = await renderApp(`/projects/${P1}`);
    expect(await screen.findAllByText(/Starts /)).not.toHaveLength(0);
    first.unmount();
    serve({ project: detail({ startDate: '2000-01-01', endDate: '2000-12-31' }) });
    const second = await renderApp(`/projects/${P1}`);
    expect(await screen.findAllByText(/Ended /)).not.toHaveLength(0);
    second.unmount();
    serve({ project: detail({ startDate: '2000-01-01', endDate: '2999-12-31' }) });
    const third = await renderApp(`/projects/${P1}`);
    expect(await screen.findByText(/% of the time has passed/)).toBeInTheDocument();
    third.unmount();
    serve({ project: detail({ endDate: null }) });
    await renderApp(`/projects/${P1}`);
    expect(await screen.findByText('This project has no end date yet.')).toBeInTheDocument();
    // a start alone is no track
    expect(screen.queryByRole('list', { name: 'Timeline' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('milestones', () => {
  it('shows dates, the overdue warning and the finished state', async () => {
    as('hr');
    serve({
      project: detail({
        milestones: [
          milestone(1, { overdueDays: 3 }),
          milestone(2, { status: 'done', doneOn: '2026-02-20' }),
          milestone(3),
        ],
      }),
    });
    await renderApp(`/projects/${P1}`);
    const list = await screen.findByRole('list', { name: 'Milestones' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('3 days overdue');
    expect(rows[1]).toHaveTextContent('Finished');
    expect(rows[1]).toHaveTextContent('Done');
    expect(rows[2]).not.toHaveTextContent('overdue');
  });

  it('adds a milestone after checking the form', async () => {
    as('hr');
    serve({ project: detail() });
    const bodies: unknown[] = [];
    server.use(
      http.post(
        `${API}/projects/${P1}/milestones`,
        async ({ request }) => (
          bodies.push(await request.json()),
          HttpResponse.json(milestone(1), { status: 201 })
        ),
      ),
    );
    await renderApp(`/projects/${P1}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add milestone' }));
    const form = within(screen.getByRole('form', { name: 'Add milestone' }));
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This field is required.')).toBeInTheDocument();
    expect(bodies).toEqual([]);
    await user.type(form.getByLabelText('Milestone'), ' Beta ');
    await user.clear(form.getByLabelText('Due date'));
    await user.type(form.getByLabelText('Due date'), '2026-12-01');
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toEqual([{ title: 'Beta', dueDate: '2026-12-01' }]));
  });

  it('finishes, reopens and deletes', async () => {
    as('hr');
    serve({
      project: detail({
        milestones: [milestone(1), milestone(2, { status: 'done', doneOn: '2026-02-20' })],
      }),
    });
    const patches: unknown[] = [];
    const deleted: string[] = [];
    server.use(
      http.patch(`${API}/projects/${P1}/milestones/:id`, async ({ request, params }) => {
        patches.push([params.id, await request.json()]);
        return HttpResponse.json(milestone(1));
      }),
      http.delete(`${API}/projects/${P1}/milestones/:id`, ({ params }) => {
        deleted.push(String(params.id));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderApp(`/projects/${P1}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Mark as done' }));
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() =>
      expect(patches).toEqual([
        [uuid(301), { status: 'done' }],
        [uuid(302), { status: 'open' }],
      ]),
    );
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    await waitFor(() => expect(deleted).toEqual([uuid(301)]));
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the team', () => {
  it('lists people with role, allocation, period and the over-allocation warning', async () => {
    as('hr');
    serve({
      project: detail({
        assignments: [
          assignment(1, { overAllocated: true, toDate: '2026-06-30' }),
          assignment(2, { role: null, allocationPct: 100 }),
        ],
      }),
    });
    await renderApp(`/projects/${P1}`);
    const list = await screen.findByRole('list', { name: 'Team' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Person1 Test');
    expect(rows[0]).toHaveTextContent('Backend · 50% of their time');
    expect(rows[0]).toHaveTextContent('Over-allocated');
    expect(rows[1]).toHaveTextContent('100% of their time');
    expect(rows[1]).not.toHaveTextContent('Over-allocated');
  });

  it('adds somebody after checking the form, with the chosen person', async () => {
    as('hr');
    serve({ project: detail(), people: people(['Lena']) });
    const bodies: unknown[] = [];
    server.use(
      http.post(
        `${API}/projects/${P1}/assignments`,
        async ({ request }) => (
          bodies.push(await request.json()),
          HttpResponse.json(assignment(1), { status: 201 })
        ),
      ),
    );
    await renderApp(`/projects/${P1}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add person' }));
    const form = within(screen.getByRole('form', { name: 'Add person' }));
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This field is required.')).toBeInTheDocument(); // no person
    expect(bodies).toEqual([]);
    await form.findByRole('option', { name: 'Lena Test' });
    await user.selectOptions(form.getByLabelText('Person'), 'Lena Test');
    await user.type(form.getByLabelText('Role (optional)'), ' Dev ');
    const allocation = form.getByLabelText('Allocation (%)');
    await user.clear(allocation);
    await user.type(allocation, '150');
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a whole number from 1 to 100.')).toBeInTheDocument();
    await user.clear(allocation);
    await user.type(allocation, '60');
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ employeeId: uuid(90), role: 'Dev', allocationPct: 60 });
    expect(bodies[0]).not.toHaveProperty('toDate');
  });

  it('searches the directory while typing', async () => {
    as('hr');
    const calls = serve({ project: detail(), people: people(['Lena']) });
    await renderApp(`/projects/${P1}`);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Add person' }));
    await userEvent.setup().type(screen.getByLabelText('Search for Person'), 'len');
    await waitFor(() => expect(calls.employees.at(-1)!.searchParams.get('q')).toBe('len'));
    expect(calls.employees.at(-1)!.searchParams.get('status')).toBe('active');
  });

  it('edits and removes an assignment', async () => {
    as('hr');
    serve({ project: detail({ assignments: [assignment(1)] }) });
    const patches: unknown[] = [];
    const deleted: string[] = [];
    server.use(
      http.patch(
        `${API}/projects/${P1}/assignments/:id`,
        async ({ request }) => (
          patches.push(await request.json()),
          HttpResponse.json(assignment(1))
        ),
      ),
      http.delete(
        `${API}/projects/${P1}/assignments/:id`,
        ({ params }) => (deleted.push(String(params.id)), new HttpResponse(null, { status: 204 })),
      ),
    );
    await renderApp(`/projects/${P1}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const form = within(screen.getByRole('form', { name: 'Edit' }));
    expect(form.queryByLabelText('Person')).not.toBeInTheDocument(); // the person never changes
    const allocation = form.getByLabelText('Allocation (%)');
    await user.clear(allocation);
    await user.type(allocation, '80');
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(patches).toEqual([
        { role: 'Backend', allocationPct: 80, fromDate: '2026-02-02', toDate: null },
      ]),
    );
    await user.click(await screen.findByRole('button', { name: 'Remove Person1 Test' }));
    await waitFor(() => expect(deleted).toEqual([uuid(401)]));
  });

  it('explains a refused overlap', async () => {
    as('hr');
    serve({ project: detail(), people: people(['Lena']) });
    server.use(
      http.post(`${API}/projects/${P1}/assignments`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'overlap' } }),
      ),
    );
    await renderApp(`/projects/${P1}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add person' }));
    const form = within(screen.getByRole('form', { name: 'Add person' }));
    await form.findByRole('option', { name: 'Lena Test' });
    await user.selectOptions(form.getByLabelText('Person'), 'Lena Test');
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('This person is already on the project in this period.'),
    ).toBeInTheDocument();
  });

  it('offers no actions when the server says the caller cannot staff', async () => {
    as('manager');
    serve({ project: detail({ canStaff: false, assignments: [assignment(1)] }) });
    await renderApp(`/projects/${P1}`);
    await screen.findByText('Person1 Test');
    expect(screen.queryByRole('button', { name: 'Add person' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('clients', () => {
  it('lists clients with their projects; managers read, HR changes', async () => {
    as('manager');
    serve({
      clients: [
        client(1, { projectCount: 2, contactName: 'Bill', contactEmail: 'bill@initech.eu' }),
        client(2, { status: 'archived' }),
      ],
    });
    const first = await renderApp('/projects?tab=clients');
    const list = await screen.findByRole('list', { name: 'Clients' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Client 1');
    expect(rows[0]).toHaveTextContent('2 projects');
    expect(rows[0]).toHaveTextContent('bill@initech.eu');
    expect(rows[1]).toHaveTextContent('Archived');
    expect(screen.queryByRole('button', { name: 'Add client' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    first.unmount();
    as('hr');
    serve({ clients: [client(1)] });
    await renderApp('/projects?tab=clients');
    expect(await screen.findByRole('button', { name: 'Add client' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });

  it('adds a client after checking the form', async () => {
    as('hr');
    serve();
    const bodies: unknown[] = [];
    server.use(
      http.post(
        `${API}/clients`,
        async ({ request }) => (
          bodies.push(await request.json()),
          HttpResponse.json(client(1), { status: 201 })
        ),
      ),
    );
    await renderApp('/projects?tab=clients');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add client' }));
    const form = within(screen.getByRole('form', { name: 'Add client' }));
    await user.type(form.getByLabelText('Contact email (optional)'), 'nope');
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This field is required.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(bodies).toEqual([]);
    await user.type(form.getByLabelText('Name'), ' Initech ');
    const email = form.getByLabelText('Contact email (optional)');
    await user.clear(email);
    await user.type(email, 'Bill@Initech.EU');
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bodies).toEqual([{ name: 'Initech', contactEmail: 'bill@initech.eu' }]),
    );
  });

  it('archives and restores, and explains a duplicate name', async () => {
    as('hr');
    serve({ clients: [client(1), client(2, { status: 'archived' })] });
    const patches: unknown[] = [];
    server.use(
      http.patch(
        `${API}/clients/${uuid(41)}`,
        async ({ request }) => (patches.push(await request.json()), HttpResponse.json(client(1))),
      ),
      http.patch(`${API}/clients/${uuid(42)}`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'name' } }),
      ),
    );
    await renderApp('/projects?tab=clients');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(patches).toEqual([{ status: 'archived' }]));
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('A client with this name already exists.')).toBeInTheDocument();
  });
});
