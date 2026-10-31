import type { ChartNode, Department, Employee, OrgChart, Team } from '@intime/contracts';
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

const node = (
  n: number,
  first: string,
  last: string,
  managerId: string | null,
  extra: Partial<ChartNode> = {},
): ChartNode => ({
  id: uuid(n),
  firstName: first,
  lastName: last,
  jobTitle: null,
  managerId,
  departmentId: null,
  ...extra,
});

const ENG = uuid(101);
const OPS = uuid(102);

// Ada (CEO) -> Bob -> Cy -> Di ; Ada -> Eli ; Zed has a manager who is not in the list
const NODES: ChartNode[] = [
  node(1, 'Ada', 'Boss', null, { jobTitle: 'CEO' }),
  node(2, 'Bob', 'Lead', uuid(1), { departmentId: ENG }),
  node(3, 'Cy', 'Dev', uuid(2), { departmentId: ENG }),
  node(4, 'Di', 'Intern', uuid(3)),
  node(5, 'Eli', 'Ops', uuid(1), { departmentId: OPS }),
  node(6, 'Zed', 'Orphan', uuid(999)),
];

const person = (n: number) => ({
  id: uuid(n),
  firstName: NODES[n - 1]!.firstName,
  lastName: NODES[n - 1]!.lastName,
});

const DEPARTMENTS: Department[] = [
  { id: ENG, name: 'Engineering', parentId: null, head: person(2), employeeCount: 2, teamCount: 1 },
  { id: OPS, name: 'Operations', parentId: ENG, head: null, employeeCount: 1, teamCount: 0 },
];

const TEAMS: Team[] = [
  {
    id: uuid(201),
    name: 'Backend',
    department: { id: ENG, name: 'Engineering' },
    lead: person(3),
    members: [person(3), person(4)],
  },
];

function serveOrg(
  overrides: { nodes?: ChartNode[]; departments?: Department[]; teams?: Team[] } = {},
) {
  const chart: OrgChart = { nodes: overrides.nodes ?? NODES };
  server.use(
    http.get(`${API}/org/chart`, () => HttpResponse.json(chart)),
    http.get(`${API}/org/departments`, () =>
      HttpResponse.json(overrides.departments ?? DEPARTMENTS),
    ),
    http.get(`${API}/org/teams`, () => HttpResponse.json(overrides.teams ?? TEAMS)),
  );
}
const as = (role: 'hr' | 'employee') => server.use(...signedInHandlers(userWithRole(role)));

describe('organization chart', () => {
  const card = (name: string) => screen.getByRole('article', { name });
  const noCard = (name: string) => screen.queryByRole('article', { name });

  it('shows the reporting tree with titles and departments, deeper levels collapsed', async () => {
    serveOrg();
    await renderApp('/organization');
    expect(await screen.findByRole('heading', { name: 'Organization' })).toBeInTheDocument();
    expect(await screen.findByRole('article', { name: 'Ada Boss' })).toHaveTextContent('CEO');
    expect(card('Bob Lead')).toHaveTextContent('Engineering'); // department badge
    expect(card('Cy Dev')).toBeInTheDocument(); // level 2 is open
    expect(noCard('Di Intern')).not.toBeInTheDocument(); // level 3 starts collapsed
    expect(screen.getByText('1 direct report')).toBeInTheDocument();
    // Bob's reports are listed under him
    expect(screen.getByRole('list', { name: 'Reports of Bob Lead' })).toHaveTextContent('Cy Dev');
  });

  it('expands and collapses branches and links to the employee', async () => {
    serveOrg();
    await renderApp('/organization');
    const user = userEvent.setup();
    const toggle = await screen.findByRole('button', { name: 'Show reports of Cy Dev' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(card('Di Intern')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View profile Di Intern' })).toHaveAttribute(
      'href',
      `/employees/${uuid(4)}`,
    );
    await user.click(screen.getByRole('button', { name: 'Hide reports of Cy Dev' }));
    expect(noCard('Di Intern')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide reports of Ada Boss' }));
    expect(noCard('Bob Lead')).not.toBeInTheDocument();
  });

  it('opens and closes every branch at once', async () => {
    serveOrg();
    await renderApp('/organization');
    const user = userEvent.setup();
    await screen.findByRole('article', { name: 'Ada Boss' });
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(card('Di Intern')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(noCard('Bob Lead')).not.toBeInTheDocument();
    expect(card('Ada Boss')).toBeInTheDocument();
    expect(card('Zed Orphan')).toBeInTheDocument();
  });

  it('shows more about a person: direct reports, the whole branch and the department', async () => {
    serveOrg();
    await renderApp('/organization');
    const user = userEvent.setup();
    const ada = await screen.findByRole('article', { name: 'Ada Boss' });
    const more = within(ada).getByRole('button', { name: 'More Ada Boss' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    const details = (label: string) => within(ada).getByText(label).nextElementSibling?.textContent;
    expect(details('Direct reports')).toBe('2');
    expect(details('People in this branch')).toBe('5'); // Ada, Bob, Cy, Di, Eli
    expect(details('Department')).toBe('No department');
    await user.click(within(ada).getByRole('button', { name: 'Less Ada Boss' }));
    expect(within(ada).queryByText('Direct reports')).not.toBeInTheDocument();
  });

  it('shows people whose manager is not listed as top-level entries instead of losing them', async () => {
    serveOrg();
    await renderApp('/organization');
    expect(await screen.findByRole('article', { name: 'Zed Orphan' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Organization chart' })).toContainElement(
      card('Zed Orphan'),
    );
  });

  it('says so when there is nobody, and offers a retry when loading fails', async () => {
    serveOrg({ nodes: [] });
    const { unmount } = await renderApp('/organization');
    expect(await screen.findByText('There are no employees yet.')).toBeInTheDocument();
    unmount();

    let fail = true;
    server.use(
      http.get(`${API}/org/chart`, () =>
        fail ? errorResponse('INTERNAL_ERROR', 500) : HttpResponse.json({ nodes: NODES }),
      ),
      http.get(`${API}/org/departments`, () => HttpResponse.json(DEPARTMENTS)),
    );
    await renderApp('/organization');
    expect(await screen.findByText(/Something went wrong on our side/)).toBeInTheDocument();
    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('article', { name: 'Ada Boss' })).toBeInTheDocument();
  });

  it('is only for people who may view the organization', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    await renderApp('/organization');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('is in German and Bulgarian', async () => {
    serveOrg();
    await initTestI18n('de');
    const { unmount } = await renderApp('/organization');
    expect(await screen.findByRole('heading', { name: 'Organisation' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Abteilungen' })).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/organization');
    expect(await screen.findByRole('heading', { name: 'Организация' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Екипи' })).toBeInTheDocument();
  });
});

describe('departments', () => {
  it('lists departments with head, counts and parent, and offers no changes to employees', async () => {
    serveOrg();
    await renderApp('/organization?tab=departments');
    const list = await screen.findByRole('list', { name: 'Departments' });
    expect(within(list).getByText('Engineering')).toBeInTheDocument();
    expect(within(list).getByText('Head: Bob Lead')).toBeInTheDocument();
    expect(within(list).getByText('2 employees · 1 team')).toBeInTheDocument();
    expect(
      within(list).getByText('Part of Engineering · 1 employee · 0 teams'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add department' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('creates a department after validation', async () => {
    as('hr');
    serveOrg();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/org/departments`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(DEPARTMENTS[0], { status: 201 });
      }),
    );
    await renderApp('/organization?tab=departments');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add department' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This field is required.')).toBeInTheDocument();
    expect(bodies).toEqual([]);

    await user.type(screen.getByLabelText('Name'), ' Sales ');
    await user.selectOptions(screen.getByLabelText('Parent department'), 'Engineering');
    await user.selectOptions(screen.getByLabelText('Department head'), 'Eli Ops');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bodies).toEqual([{ name: 'Sales', parentId: ENG, headEmployeeId: uuid(5) }]),
    );
    await waitFor(() => expect(screen.queryByLabelText('Department head')).not.toBeInTheDocument());
  });

  it('edits with the current values filled in and shows API conflicts', async () => {
    as('hr');
    serveOrg();
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${API}/org/departments/${ENG}`, async ({ request }) => {
        bodies.push(await request.json());
        return errorResponse('CONFLICT', 409, { params: { field: 'name' } });
      }),
    );
    await renderApp('/organization?tab=departments');
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!);
    expect(screen.getByLabelText('Name')).toHaveValue('Engineering');
    expect(screen.getByLabelText('Department head')).toHaveValue(uuid(2));
    // a department cannot be its own parent: it is not offered
    expect(
      within(screen.getByLabelText('Parent department')).queryByRole('option', {
        name: 'Engineering',
      }),
    ).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Operations');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This name is already in use.')).toBeInTheDocument();
    expect(bodies).toEqual([{ name: 'Operations', parentId: null, headEmployeeId: uuid(2) }]);
  });

  it('asks before deleting and explains why a used department cannot go', async () => {
    as('hr');
    serveOrg();
    let calls = 0;
    server.use(
      http.delete(`${API}/org/departments/${ENG}`, () => {
        calls += 1;
        return errorResponse('CONFLICT', 409, { params: { field: 'in_use' } });
      }),
    );
    await renderApp('/organization?tab=departments');
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Delete' }))[0]!);
    const group = screen.getByRole('group', { name: 'Delete Engineering?' });
    expect(calls).toBe(0);
    await user.click(within(group).getByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByText(/still has employees, sub-departments or teams/),
    ).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Delete Engineering?' })).not.toBeInTheDocument();
  });

  it('says so when there are none', async () => {
    serveOrg({ departments: [] });
    await renderApp('/organization?tab=departments');
    expect(await screen.findByText('No departments yet.')).toBeInTheDocument();
  });
});

describe('teams', () => {
  it('lists teams with department, lead and members', async () => {
    serveOrg();
    await renderApp('/organization?tab=teams');
    const list = await screen.findByRole('list', { name: 'Teams' });
    expect(within(list).getByText('Backend')).toBeInTheDocument();
    expect(within(list).getByText('Engineering · Lead: Cy Dev')).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: 'Di Intern' })).toHaveAttribute(
      'href',
      `/employees/${uuid(4)}`,
    );
    expect(screen.queryByRole('button', { name: 'Add team' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('adds and removes members by sending the whole new list', async () => {
    as('hr');
    serveOrg();
    const bodies: { employeeIds: string[] }[] = [];
    server.use(
      http.put(`${API}/org/teams/${uuid(201)}/members`, async ({ request }) => {
        bodies.push((await request.json()) as { employeeIds: string[] });
        return HttpResponse.json(TEAMS[0]);
      }),
    );
    await renderApp('/organization?tab=teams');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remove Di Intern' }));
    await waitFor(() => expect(bodies[0]).toEqual({ employeeIds: [uuid(3)] }));

    const select = screen.getByLabelText('Add member');
    // people already in the team are not offered again
    expect(within(select).queryByRole('option', { name: 'Cy Dev' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    await user.selectOptions(select, 'Eli Ops');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(bodies[1]).toEqual({ employeeIds: [uuid(3), uuid(4), uuid(5)] }));
  });

  it('creates a team in a department', async () => {
    as('hr');
    serveOrg();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/org/teams`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(TEAMS[0], { status: 201 });
      }),
    );
    await renderApp('/organization?tab=teams');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add team' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This field is required.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Frontend');
    await user.selectOptions(screen.getByLabelText('Department'), 'Operations');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bodies).toEqual([{ name: 'Frontend', departmentId: OPS, leadEmployeeId: null }]),
    );
  });

  it('deletes after confirmation', async () => {
    as('hr');
    serveOrg();
    let deleted = false;
    server.use(
      http.delete(
        `${API}/org/teams/${uuid(201)}`,
        () => ((deleted = true), new HttpResponse(null, { status: 204 })),
      ),
    );
    await renderApp('/organization?tab=teams');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(deleted).toBe(false);
    await user.click(
      within(screen.getByRole('group', { name: 'Delete Backend?' })).getByRole('button', {
        name: 'Delete',
      }),
    );
    await waitFor(() => expect(deleted).toBe(true));
  });

  it('shows an error when the member list is refused', async () => {
    as('hr');
    serveOrg();
    server.use(
      http.put(`${API}/org/teams/${uuid(201)}/members`, () =>
        errorResponse('VALIDATION_FAILED', 400),
      ),
    );
    await renderApp('/organization?tab=teams');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Remove Di Intern' }));
    expect(
      await screen.findByText('Some of the information you entered is not valid.'),
    ).toBeInTheDocument();
  });
});

describe('manager and department on the employee page', () => {
  const employee = (overrides: Partial<Employee> = {}): Employee => ({
    id: uuid(3),
    firstName: 'Cy',
    lastName: 'Dev',
    jobTitle: 'Developer',
    location: null,
    email: 'cy@acme.eu',
    status: 'active',
    department: { id: ENG, name: 'Engineering' },
    manager: { id: uuid(2), firstName: 'Bob', lastName: 'Lead' },
    teams: [
      { id: uuid(201), name: 'Backend' },
      { id: uuid(202), name: 'Platform' },
    ],
    isSelf: false,
    profile: null,
    ...overrides,
  });
  const serve = (e: Employee) => {
    serveOrg();
    server.use(http.get(`${API}/employees/${e.id}`, () => HttpResponse.json(e)));
  };

  it('shows department, manager and teams to everybody', async () => {
    serve(employee());
    await renderApp(`/employees/${uuid(3)}`);
    expect(await screen.findByText('Bob Lead')).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Backend and Platform')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Change manager and department' }),
    ).not.toBeInTheDocument();
  });

  it('leaves department, manager and teams out of the header when there are none', async () => {
    serve(employee({ department: null, manager: null, teams: [] }));
    await renderApp(`/employees/${uuid(3)}`);
    await screen.findByRole('heading', { name: 'Cy Dev' });
    const facts = screen.getByRole('list', { name: 'Key facts' });
    expect(facts).not.toHaveTextContent('Manager');
    // only the email links; there is no manager to link to
    expect(
      within(facts)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual(['mailto:cy@acme.eu']);
  });

  it('lets HR change both, never offering the person as their own manager', async () => {
    as('hr');
    serve(employee());
    const bodies: unknown[] = [];
    server.use(
      http.put(`${API}/org/employees/${uuid(3)}/assignment`, async ({ request }) => {
        bodies.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderApp(`/employees/${uuid(3)}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change manager and department' }));
    const panel = screen.getByRole('group', { name: 'Manager and department' });
    const manager = within(panel).getByLabelText('Manager');
    expect(manager).toHaveValue(uuid(2));
    expect(within(manager).queryByRole('option', { name: 'Cy Dev' })).not.toBeInTheDocument();
    await user.selectOptions(manager, 'Ada Boss');
    await user.selectOptions(within(panel).getByLabelText('Department'), 'Operations');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toEqual([{ managerId: uuid(1), departmentId: OPS }]));
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Manager and department' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('sends nulls when both are cleared and explains a reporting loop', async () => {
    as('hr');
    serve(employee());
    const bodies: unknown[] = [];
    server.use(
      http.put(`${API}/org/employees/${uuid(3)}/assignment`, async ({ request }) => {
        bodies.push(await request.json());
        return errorResponse('ORG_CYCLE', 409);
      }),
    );
    await renderApp(`/employees/${uuid(3)}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change manager and department' }));
    await user.selectOptions(screen.getByLabelText('Manager'), 'No manager');
    await user.selectOptions(screen.getByLabelText('Department'), 'No department');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'This would put someone above themselves in the reporting structure.',
      ),
    ).toBeInTheDocument();
    expect(bodies).toEqual([{ managerId: null, departmentId: null }]);
  });

  it('does not offer it for inactive employees', async () => {
    as('hr');
    serve(employee({ status: 'inactive' }));
    await renderApp(`/employees/${uuid(3)}`);
    await screen.findByRole('heading', { name: 'Cy Dev' });
    expect(
      screen.queryByRole('button', { name: 'Change manager and department' }),
    ).not.toBeInTheDocument();
  });
});
