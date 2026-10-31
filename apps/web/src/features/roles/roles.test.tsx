import {
  getPermission,
  type PermissionCode,
  type RoleDetail,
  type RoleListItem,
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
const ADMIN_ROLE = uuid(1);
const CLERK = uuid(2);

const item = (o: Partial<RoleListItem> & { id: string; name: string }): RoleListItem => ({
  key: null,
  description: null,
  isSystem: false,
  permissionCount: 0,
  userCount: 0,
  parentId: null,
  modules: [],
  ...o,
});
const detail = (o: Partial<RoleDetail> & { id: string; name: string }): RoleDetail => ({
  key: null,
  description: null,
  isSystem: false,
  grants: [],
  userCount: 0,
  parentId: null,
  ...o,
});

const adminRole = detail({
  id: ADMIN_ROLE,
  key: 'admin',
  name: 'Admin',
  isSystem: true,
  grants: [
    { code: 'admin.role.manage', scope: 'all' },
    { code: 'leave.approve', scope: 'all' },
  ],
  userCount: 1,
});
const clerk = detail({
  id: CLERK,
  name: 'Payroll clerk',
  description: 'Handles pay',
  grants: [{ code: 'leave.approve', scope: 'team' }],
  userCount: 2,
  parentId: ADMIN_ROLE,
});

interface Backend {
  calls: { method: string; path: string; body: unknown }[];
}

function serve(roles: RoleDetail[] = [adminRole, clerk]): Backend {
  const backend: Backend = { calls: [] };
  server.use(
    http.get(`${API}/roles`, () =>
      HttpResponse.json(
        roles.map((r) =>
          item({
            id: r.id,
            name: r.name,
            key: r.key,
            description: r.description,
            isSystem: r.isSystem,
            permissionCount: r.grants.length,
            userCount: r.userCount,
            parentId: r.parentId,
            modules: [
              ...new Set(r.grants.map((g) => getPermission(g.code as PermissionCode).module)),
            ],
          }),
        ),
      ),
    ),
    http.get(`${API}/roles/:id`, ({ params }) => {
      const found = roles.find((r) => r.id === params.id);
      return found ? HttpResponse.json(found) : errorResponse('NOT_FOUND', 404);
    }),
    http.post(`${API}/roles`, async ({ request }) => {
      const body = (await request.json()) as { name: string; grants: RoleDetail['grants'] };
      backend.calls.push({ method: 'POST', path: 'roles', body });
      const created = detail({ id: uuid(9), name: body.name, grants: body.grants });
      roles.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.put(`${API}/roles/:id`, async ({ request, params }) => {
      const body = (await request.json()) as { name: string; grants: RoleDetail['grants'] };
      backend.calls.push({ method: 'PUT', path: String(params.id), body });
      return HttpResponse.json(
        detail({ id: String(params.id), name: body.name, grants: body.grants }),
      );
    }),
    http.put(`${API}/roles/:id/parent`, async ({ request, params }) => {
      const body = (await request.json()) as { parentId: string | null };
      backend.calls.push({ method: 'MOVE', path: String(params.id), body });
      const found = roles.find((r) => r.id === params.id)!;
      found.parentId = body.parentId;
      return HttpResponse.json(found);
    }),
    http.delete(`${API}/roles/:id`, ({ params }) => {
      backend.calls.push({ method: 'DELETE', path: String(params.id), body: null });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return backend;
}

const as = (role: 'employee' | 'manager' | 'hr' | 'admin') =>
  server.use(...signedInHandlers(userWithRole(role)));
/** May look at roles but not change them. */
const asViewer = () =>
  server.use(...signedInHandlers(userWithPermissions({ 'admin.role.view': 'all' })));

describe('role tree (ADR 0036)', () => {
  const LEAD = uuid(3);
  const JUNIOR = uuid(4);
  const LONE = uuid(5);
  const tree = () => [
    adminRole,
    { ...clerk },
    detail({ id: LEAD, name: 'Team lead', parentId: ADMIN_ROLE, userCount: 4 }),
    detail({ id: JUNIOR, name: 'Junior lead', parentId: LEAD }),
    detail({ id: LONE, name: 'Contractor', description: 'Outside help' }),
  ];

  it('shows roots on top and their sub-roles below, with kind, figures and modules', async () => {
    as('admin');
    serve(tree());
    await renderApp('/roles');
    const top = await screen.findByRole('list', { name: 'Role hierarchy' });
    const roots = within(top)
      .getAllByRole('listitem')
      .filter((li) => li.parentElement === top);
    expect(roots).toHaveLength(2);
    expect(within(roots[0]!).getAllByRole('article')[0]).toHaveAccessibleName('Admin');
    expect(within(roots[1]!).getByRole('article')).toHaveAccessibleName('Contractor');

    const below = screen.getByRole('list', { name: 'Roles under Admin' });
    const columns = within(below)
      .getAllByRole('article')
      .map((a) => a.getAttribute('aria-label'));
    expect(columns).toEqual(['Payroll clerk', 'Team lead', 'Junior lead']);
    expect(screen.getByRole('list', { name: 'Roles under Team lead' })).toHaveTextContent(
      'Junior lead',
    );

    const clerkCard = screen.getByRole('article', { name: 'Payroll clerk' });
    expect(clerkCard).toHaveTextContent('Custom');
    expect(clerkCard).toHaveTextContent('Handles pay');
    expect(clerkCard).toHaveTextContent('2 people');
    expect(clerkCard).toHaveTextContent('1 permission');
    expect(clerkCard).toHaveTextContent('Leave');
    const admin = screen.getByRole('article', { name: 'Admin' });
    expect(admin).toHaveTextContent('System');
    expect(admin).toHaveTextContent('2 sub-roles');
    expect(screen.getByRole('article', { name: 'Contractor' })).toHaveTextContent('No permissions');
    expect(screen.getByRole('link', { name: 'Payroll clerk' })).toHaveAttribute(
      'href',
      `/roles/${CLERK}`,
    );
    expect(screen.getByRole('link', { name: 'New role' })).toHaveAttribute('href', '/roles/new');
  });

  it('folds a branch away and opens it again', async () => {
    as('admin');
    serve(tree());
    await renderApp('/roles');
    const user = userEvent.setup();
    const toggle = await screen.findByRole('button', { name: /Hide the roles under Team lead/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(screen.queryByRole('article', { name: 'Junior lead' })).not.toBeInTheDocument();
    const open = screen.getByRole('button', { name: /Show the roles under Team lead/ });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    await user.click(open);
    expect(screen.getByRole('article', { name: 'Junior lead' })).toBeInTheDocument();
  });

  it('moves a role; its own sub-roles are not offered as a new place', async () => {
    as('admin');
    const backend = serve(tree());
    await renderApp('/roles');
    const user = userEvent.setup();
    const lead = await screen.findByRole('article', { name: 'Team lead' });
    await user.click(within(lead).getByRole('button', { name: /Move/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Move Team lead' });
    expect(dialog).toHaveTextContent('Nobody gains or loses a permission');
    const select = within(dialog).getByLabelText('Sits under');
    expect(select).toHaveValue(ADMIN_ROLE);
    const offered = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent?.trim());
    expect(offered).toEqual(['Top level', 'Admin', 'Admin › Payroll clerk', 'Contractor']);
    await user.selectOptions(select, 'Contractor');
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(backend.calls).toEqual([{ method: 'MOVE', path: LEAD, body: { parentId: LONE } }]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('list', { name: 'Roles under Contractor' })).toHaveTextContent(
      'Team lead',
    );
  });

  it('moves a role to the top level, and explains a refused move', async () => {
    as('admin');
    const backend = serve(tree());
    server.use(
      http.put(`${API}/roles/${JUNIOR}/parent`, () =>
        errorResponse('VALIDATION_FAILED', 400, {
          details: [{ path: 'parentId', code: 'role_cycle', message: 'no' }],
        }),
      ),
    );
    await renderApp('/roles');
    const user = userEvent.setup();
    await user.click(
      within(await screen.findByRole('article', { name: 'Junior lead' })).getByRole('button', {
        name: /Move/,
      }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Sits under'), 'Top level');
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(
      await within(dialog).findByText(/cannot sit under itself or one of its own sub-roles/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(backend.calls).toEqual([]);

    await user.click(
      within(screen.getByRole('article', { name: 'Payroll clerk' })).getByRole('button', {
        name: /Move/,
      }),
    );
    const again = await screen.findByRole('dialog');
    await user.selectOptions(within(again).getByLabelText('Sits under'), 'Top level');
    await user.click(within(again).getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(backend.calls).toEqual([{ method: 'MOVE', path: CLERK, body: { parentId: null } }]),
    );
  });

  it('offers no "New role" and no moving to people who may only look', async () => {
    asViewer();
    serve(tree());
    await renderApp('/roles');
    await screen.findByRole('list', { name: 'Role hierarchy' });
    expect(screen.queryByRole('link', { name: 'New role' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move/ })).not.toBeInTheDocument();
    // folding still works for them
    expect(screen.getByRole('button', { name: /Hide the roles under Admin/ })).toBeInTheDocument();
  });

  it('lets HR build and move roles (ADR 0036)', async () => {
    as('hr');
    serve(tree());
    await renderApp('/roles');
    expect(await screen.findByRole('link', { name: 'New role' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Move/ }).length).toBe(5);
  });

  it('is not for people without the permission', async () => {
    as('employee');
    serve();
    await renderApp('/roles');
    expect(await screen.findByText('No access')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Role hierarchy' })).not.toBeInTheDocument();
  });

  it('shows the error with a retry when the roles cannot be loaded', async () => {
    as('admin');
    server.use(http.get(`${API}/roles`, () => errorResponse('INTERNAL_ERROR', 500)));
    await renderApp('/roles');
    expect(await screen.findByText(/Something went wrong on our side/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('a system role', () => {
  it('is shown read-only, grouped by module, with the reach in words', async () => {
    as('admin');
    serve();
    await renderApp(`/roles/${ADMIN_ROLE}`);
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByText(/System role \(fixed\)/)).toBeInTheDocument();
    expect(screen.getByText('Administration')).toBeInTheDocument();
    expect(screen.getByText('Create, change, move and delete custom roles')).toBeInTheDocument();
    expect(screen.getAllByText('Everyone').length).toBeGreaterThan(0);
    // nothing to change
    const page = within(screen.getByRole('main'));
    expect(page.queryByRole('form')).not.toBeInTheDocument();
    expect(page.queryByRole('combobox')).not.toBeInTheDocument();
    expect(page.queryByRole('button', { name: 'Delete this role' })).not.toBeInTheDocument();
    // modules without permissions are left out
    expect(page.queryByText('Skills')).not.toBeInTheDocument();
  });

  it('says so when a role has no permissions, and when it does not exist', async () => {
    as('hr');
    serve([detail({ id: CLERK, name: 'Empty', isSystem: true })]);
    await renderApp(`/roles/${CLERK}`);
    expect(await screen.findByText('This role has no permissions.')).toBeInTheDocument();
  });

  it('answers an unknown role with a not-found card', async () => {
    as('admin');
    serve();
    await renderApp(`/roles/${uuid(77)}`);
    expect(await screen.findByText('Role not found')).toBeInTheDocument();
  });
});

describe('changing a custom role', () => {
  it('shows an editor with the current values and sends what was changed', async () => {
    as('admin');
    const backend = serve();
    await renderApp(`/roles/${CLERK}`);
    const form = within(await screen.findByRole('form', { name: 'Change role' }));
    expect(form.getByLabelText('Name')).toHaveValue('Payroll clerk');
    expect(form.getByLabelText('Description (optional)')).toHaveValue('Handles pay');
    const approve = form.getByLabelText('Approve or reject leave requests');
    expect(approve).toHaveValue('team');
    const user = userEvent.setup();
    await user.selectOptions(approve, 'Everyone');
    await user.selectOptions(form.getByLabelText('Create employees'), 'Everyone');
    await user.clear(form.getByLabelText('Name'));
    await user.type(form.getByLabelText('Name'), 'Pay team');
    await user.click(form.getByRole('button', { name: 'Save role' }));
    await waitFor(() => expect(backend.calls).toHaveLength(1));
    expect(backend.calls[0]).toEqual({
      method: 'PUT',
      path: CLERK,
      body: {
        name: 'Pay team',
        description: 'Handles pay',
        grants: [
          { code: 'employee.create', scope: 'all' },
          { code: 'leave.approve', scope: 'all' },
        ],
        parentId: ADMIN_ROLE,
      },
    });
    expect(await screen.findByText(/The role was saved/)).toBeInTheDocument();
  });

  it('removes a permission with "No access"', async () => {
    as('admin');
    const backend = serve();
    await renderApp(`/roles/${CLERK}`);
    const form = within(await screen.findByRole('form', { name: 'Change role' }));
    const user = userEvent.setup();
    await user.selectOptions(form.getByLabelText('Approve or reject leave requests'), 'No access');
    await user.click(form.getByRole('button', { name: 'Save role' }));
    await waitFor(() => expect(backend.calls).toHaveLength(1));
    expect((backend.calls[0]!.body as { grants: unknown[] }).grants).toEqual([]);
  });

  it('checks the name before sending anything', async () => {
    as('admin');
    const backend = serve();
    await renderApp(`/roles/${CLERK}`);
    const form = within(await screen.findByRole('form', { name: 'Change role' }));
    const user = userEvent.setup();
    await user.clear(form.getByLabelText('Name'));
    await user.click(form.getByRole('button', { name: 'Save role' }));
    expect(await form.findByText('This field is required.')).toBeInTheDocument();
    expect(backend.calls).toEqual([]);
  });

  it('explains a name that is taken and a permission that may not be handed out', async () => {
    as('admin');
    serve();
    server.use(
      http.put(`${API}/roles/${CLERK}`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'name' } }),
      ),
    );
    await renderApp(`/roles/${CLERK}`);
    const form = within(await screen.findByRole('form', { name: 'Change role' }));
    const user = userEvent.setup();
    await user.click(form.getByRole('button', { name: 'Save role' }));
    expect(await form.findByText('A role with this name already exists.')).toBeInTheDocument();
    server.use(
      http.put(`${API}/roles/${CLERK}`, () =>
        errorResponse('FORBIDDEN', 403, {
          details: [{ path: 'grants.x', code: 'cannot_grant', message: 'no' }],
        }),
      ),
    );
    await user.click(form.getByRole('button', { name: 'Save role' }));
    expect(
      await form.findByText(/only hand out permissions that you hold yourself/),
    ).toBeInTheDocument();
  });

  it('asks before deleting, keeps the role on "Keep it" and deletes it on confirmation', async () => {
    as('admin');
    const backend = serve();
    await renderApp(`/roles/${CLERK}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete this role' }));
    expect(screen.getByText('Delete this role for good?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(backend.calls).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Delete this role' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() =>
      expect(backend.calls).toEqual([{ method: 'DELETE', path: CLERK, body: null }]),
    );
    expect(await screen.findByRole('list', { name: 'Role hierarchy' })).toBeInTheDocument();
  });

  it('says why a role in use cannot be deleted', async () => {
    as('admin');
    serve();
    server.use(
      http.delete(`${API}/roles/${CLERK}`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'in_use' } }),
      ),
    );
    await renderApp(`/roles/${CLERK}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete this role' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByText(/Somebody still holds this role/)).toBeInTheDocument();
  });

  it('shows a custom role read-only to people who may look but not manage', async () => {
    asViewer();
    serve();
    await renderApp(`/roles/${CLERK}`);
    expect(await screen.findByRole('heading', { name: 'Payroll clerk' })).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete this role' })).not.toBeInTheDocument();
    expect(screen.getByText('Approve or reject leave requests')).toBeInTheDocument();
  });
});

describe('a new role', () => {
  it('can be placed under another role', async () => {
    as('admin');
    const backend = serve();
    await renderApp('/roles/new');
    const form = within(await screen.findByRole('form', { name: 'New role' }));
    const user = userEvent.setup();
    await user.type(form.getByLabelText('Name'), 'Team lead');
    const parent = form.getByLabelText('Sits under');
    expect(parent).toHaveValue('');
    expect(form.getByText(/permissions are never inherited/)).toBeInTheDocument();
    await waitFor(() => expect(within(parent).getAllByRole('option')).toHaveLength(3));
    await user.selectOptions(parent, CLERK);
    await user.click(form.getByRole('button', { name: 'Save role' }));
    await waitFor(() => expect(backend.calls).toHaveLength(1));
    expect(backend.calls[0]!.body).toMatchObject({ name: 'Team lead', parentId: CLERK });
  });

  it('in the editor of an existing role, shows its place and never offers itself', async () => {
    as('admin');
    serve();
    await renderApp(`/roles/${CLERK}`);
    const form = within(await screen.findByRole('form', { name: 'Change role' }));
    const parent = form.getByLabelText('Sits under');
    await waitFor(() => expect(parent).toHaveValue(ADMIN_ROLE));
    const offered = within(parent)
      .getAllByRole('option')
      .map((o) => o.textContent?.trim());
    expect(offered).toEqual(['Top level', 'Admin']);
  });

  it('creates a role from a name and chosen permissions', async () => {
    as('admin');
    const backend = serve();
    await renderApp('/roles/new');
    const form = within(await screen.findByRole('form', { name: 'New role' }));
    const user = userEvent.setup();
    await user.type(form.getByLabelText('Name'), 'Contractor');
    await user.selectOptions(
      form.getByLabelText('See the organization chart, departments and teams'),
      'Everyone',
    );
    await user.click(form.getByRole('button', { name: 'Save role' }));
    await waitFor(() => expect(backend.calls).toHaveLength(1));
    expect(backend.calls[0]).toEqual({
      method: 'POST',
      path: 'roles',
      body: { name: 'Contractor', grants: [{ code: 'org.view', scope: 'all' }], parentId: null },
    });
    expect(await screen.findByRole('heading', { name: 'Contractor' })).toBeInTheDocument();
  });

  it('is only for people who may manage roles', async () => {
    asViewer();
    serve();
    await renderApp('/roles/new');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('starts from a copy and keeps only what the user may hand out', async () => {
    server.use(
      ...signedInHandlers(
        userWithPermissions({
          'admin.role.view': 'all',
          'admin.role.manage': 'all',
          'leave.approve': 'team',
        }),
      ),
    );
    serve([
      detail({
        id: CLERK,
        name: 'Wide role',
        grants: [
          { code: 'leave.approve', scope: 'all' },
          { code: 'org.view', scope: 'all' },
        ],
      }),
    ]);
    await renderApp('/roles/new');
    const form = within(await screen.findByRole('form', { name: 'New role' }));
    const user = userEvent.setup();
    await user.selectOptions(await form.findByLabelText('Start from a copy of'), 'Wide role');
    // neither the wider reach of leave.approve nor org.view was handed out
    await waitFor(() =>
      expect(form.getByLabelText('Approve or reject leave requests')).toHaveValue(''),
    );
    expect(form.getByLabelText('See the organization chart, departments and teams')).toHaveValue(
      '',
    );
  });

  it('does not offer what the user does not hold themselves', async () => {
    server.use(
      ...signedInHandlers(
        userWithPermissions({
          'admin.role.view': 'all',
          'admin.role.manage': 'all',
          'leave.approve': 'team',
        }),
      ),
    );
    serve();
    await renderApp('/roles/new');
    const form = within(await screen.findByRole('form', { name: 'New role' }));
    const approve = form.getByLabelText('Approve or reject leave requests');
    const option = (name: string) =>
      within(approve).getByRole('option', { name }) as HTMLOptionElement;
    expect(option('Own records only').disabled).toBe(false);
    expect(option('Own and everyone below').disabled).toBe(false);
    expect(option('Own department').disabled).toBe(true);
    expect(option('Everyone').disabled).toBe(true);
    // a permission the user lacks is unavailable altogether
    const create = form.getByLabelText('Create employees');
    expect(create).toBeDisabled();
    expect(form.getAllByText('You do not hold this permission yourself.').length).toBeGreaterThan(
      0,
    );
  });
});

describe('languages', () => {
  it('shows labels, scopes and texts in German and Bulgarian', async () => {
    as('admin');
    serve();
    await initTestI18n('de');
    const { unmount } = await renderApp(`/roles/${ADMIN_ROLE}`);
    expect(await screen.findByText('Verwaltung')).toBeInTheDocument();
    expect(
      screen.getByText('Eigene Rollen anlegen, ändern, verschieben und löschen'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Alle').length).toBeGreaterThan(0);
    unmount();
    await initTestI18n('bg');
    await renderApp(`/roles/${ADMIN_ROLE}`);
    expect(await screen.findByText('Администрация')).toBeInTheDocument();
    expect(
      screen.getByText('Създава, променя, премества и изтрива собствени роли'),
    ).toBeInTheDocument();
  });
});
