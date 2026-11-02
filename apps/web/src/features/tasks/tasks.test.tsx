import type { ProjectDetail, ProjectSummary, Task } from '@intime/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
const DAN = { id: uuid(70), firstName: 'Dan', lastName: 'Dev' };
const MIA = { id: uuid(60), firstName: 'Mia', lastName: 'Manager' };

const task = (n: number, o: Partial<Task> = {}): Task => ({
  id: uuid(500 + n),
  key: `WEB-${n}`,
  number: n,
  project: { id: P1, code: 'WEB', name: 'Website' },
  milestone: null,
  title: `Task ${n}`,
  description: null,
  type: 'functional',
  status: 'todo',
  priority: 'normal',
  assignee: DAN,
  estimateHours: null,
  dueDate: null,
  doneOn: null,
  overdue: false,
  canEdit: true,
  canMove: true,
  ...o,
});

const summary = (o: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: P1,
  code: 'WEB',
  name: 'Website',
  client: null,
  status: 'active',
  priority: 'normal',
  isBillable: true,
  budgetHours: null,
  startDate: '2026-01-05',
  endDate: null,
  lead: MIA,
  health: 'on_track',
  canEdit: true,
  canStaff: true,
  ...o,
});

const detail: ProjectDetail = {
  ...summary(),
  description: null,
  milestones: [
    {
      id: uuid(301),
      title: 'Beta',
      dueDate: '2026-03-01',
      status: 'open',
      doneOn: null,
      overdueDays: 0,
    },
  ],
  assignments: [
    {
      id: uuid(401),
      employee: DAN,
      role: null,
      allocationPct: 50,
      fromDate: '2026-02-02',
      toDate: null,
      overAllocated: false,
    },
  ],
};

function serve(items: Task[] = [], projects: ProjectSummary[] = [summary()]) {
  const calls = {
    tasks: [] as URL[],
    patch: [] as unknown[],
    post: [] as unknown[],
    del: [] as string[],
  };
  server.use(
    http.get(`${API}/tasks`, ({ request }) => {
      calls.tasks.push(new URL(request.url));
      return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 50 });
    }),
    http.get(`${API}/projects`, () =>
      HttpResponse.json({ items: projects, total: projects.length, page: 1, pageSize: 25 }),
    ),
    http.get(`${API}/projects/${P1}`, () => HttpResponse.json(detail)),
    http.patch(`${API}/tasks/:id`, async ({ request, params }) => {
      const body = await request.json();
      calls.patch.push(body);
      const found = items.find((t) => t.id === params.id)!;
      return HttpResponse.json({ ...found, ...(body as object) });
    }),
    http.post(`${API}/projects/${P1}/tasks`, async ({ request }) => {
      const body = await request.json();
      calls.post.push(body);
      return HttpResponse.json(task(9), { status: 201 });
    }),
    http.delete(`${API}/tasks/:id`, ({ params }) => {
      calls.del.push(String(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}
const as = (role: 'employee' | 'manager' | 'hr') =>
  server.use(...signedInHandlers(userWithRole(role)));

describe('access and structure', () => {
  it('is not for people without a task permission', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    await renderApp('/tasks');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('needs the task permission and nothing else', async () => {
    server.use(...signedInHandlers(userWithPermissions({ 'task.view': 'own' })));
    serve([task(1, { canEdit: false })]);
    await renderApp('/tasks');
    expect(await screen.findByText('Task 1')).toBeInTheDocument();
  });

  it('gives employees the list without a way to create', async () => {
    serve([task(1, { canEdit: false })], [summary({ canEdit: false })]);
    await renderApp('/tasks');
    expect(await screen.findByText('Task 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New task' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('is in German and Bulgarian', async () => {
    serve([task(1)]);
    await initTestI18n('de');
    const { unmount } = await renderApp('/tasks');
    expect(await screen.findByRole('heading', { name: 'Aufgaben' })).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/tasks');
    expect(await screen.findByRole('heading', { name: 'Задачи' })).toBeInTheDocument();
  });
});

describe('the list and the board', () => {
  it('shows key, assignee, due date, overdue flag and hours', async () => {
    as('manager');
    serve([
      task(1, {
        dueDate: '2026-01-02',
        overdue: true,
        estimateHours: 2.5,
        milestone: { id: uuid(301), title: 'Beta' },
      }),
      task(2, { assignee: null, status: 'done', doneOn: '2026-01-03' }),
    ]);
    await renderApp('/tasks');
    const rows = within(await screen.findByRole('list', { name: 'Tasks' })).getAllByRole(
      'listitem',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('WEB-1');
    expect(rows[0]).toHaveTextContent('Dan Dev');
    expect(rows[0]).toHaveTextContent('Beta');
    expect(rows[0]).toHaveTextContent('Overdue');
    expect(rows[0]).toHaveTextContent('2.5 h');
    expect(rows[1]).toHaveTextContent('Unassigned');
    expect(rows[1]).not.toHaveTextContent('Overdue');
  });

  it('asks for open tasks first and passes every filter to the API', async () => {
    as('manager');
    const calls = serve([task(1)]);
    await renderApp('/tasks');
    await screen.findByText('Task 1');
    expect(calls.tasks.at(-1)?.searchParams.get('status')).toBe('open');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Status'), 'review');
    await user.selectOptions(screen.getByLabelText('Type'), 'non_functional');
    await user.selectOptions(screen.getByLabelText('Project'), P1);
    await user.click(screen.getByRole('checkbox', { name: 'Assigned to me' }));
    await user.type(screen.getByRole('searchbox'), 'WEB-1');
    await waitFor(() => {
      const url = calls.tasks.at(-1)!.searchParams;
      expect([
        url.get('status'),
        url.get('type'),
        url.get('projectId'),
        url.get('assignee'),
        url.get('q'),
      ]).toEqual(['review', 'non_functional', P1, 'me', 'WEB-1']);
    });
  });

  it('groups the board by status', async () => {
    as('manager');
    serve([task(1), task(2, { status: 'in_progress' }), task(3, { status: 'done' })]);
    await renderApp('/tasks?view=board');
    for (const [heading, title] of [
      ['To do (1)', 'Task 1'],
      ['In progress (1)', 'Task 2'],
      ['In review (0)', null],
      ['Done (1)', 'Task 3'],
    ] as const) {
      const section = (await screen.findByRole('heading', { name: heading })).closest('section')!;
      if (title) expect(within(section).getByText(title)).toBeInTheDocument();
      else expect(within(section).queryAllByRole('listitem')).toHaveLength(0);
    }
  });

  it('shows an empty state and an error with a retry', async () => {
    as('manager');
    serve([]);
    const { unmount } = await renderApp('/tasks');
    expect(await screen.findByText('No tasks to show.')).toBeInTheDocument();
    unmount();
    server.use(http.get(`${API}/tasks`, () => errorResponse('INTERNAL', 500)));
    await renderApp('/tasks');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('changing tasks', () => {
  it('moves a task with the status select, sending only the status', async () => {
    as('employee');
    const calls = serve([task(1, { canEdit: false, canMove: true })]);
    await renderApp('/tasks');
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Status of WEB-1'), 'in_progress');
    await waitFor(() => expect(calls.patch).toEqual([{ status: 'in_progress' }]));
  });

  it('shows the status as text when the person cannot move the task', async () => {
    serve([task(1, { canEdit: false, canMove: false, status: 'review' })]);
    await renderApp('/tasks');
    const row = (await screen.findByText('Task 1')).closest('li')!;
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument();
    expect(row).toHaveTextContent('In review');
  });

  it('shows the API error when a move is refused', async () => {
    as('employee');
    serve([task(1)]);
    server.use(http.patch(`${API}/tasks/:id`, () => errorResponse('FORBIDDEN', 403)));
    await renderApp('/tasks');
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Status of WEB-1'), 'done');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('creates a task in a chosen project with its assignee and milestone', async () => {
    as('manager');
    const calls = serve([task(1)]);
    await renderApp('/tasks');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New task' }));
    const form = screen.getByRole('form', { name: 'New task' });
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findAllByText('This field is required.')).toHaveLength(2); // project, title
    await user.selectOptions(within(form).getByLabelText('Project'), P1);
    await user.type(within(form).getByLabelText('Title'), 'Write the login');
    await user.selectOptions(
      await within(form).findByRole('combobox', { name: 'Assigned to' }),
      DAN.id,
    );
    await waitFor(() =>
      expect(within(form).getByRole('option', { name: 'Beta' })).toBeInTheDocument(),
    );
    await user.selectOptions(within(form).getByLabelText('Milestone'), uuid(301));
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.post).toEqual([
        {
          title: 'Write the login',
          type: 'functional',
          status: 'todo',
          priority: 'normal',
          milestoneId: uuid(301),
          assigneeEmployeeId: DAN.id,
        },
      ]),
    );
  });

  it('explains a refused assignee', async () => {
    as('manager');
    serve([]);
    server.use(
      http.post(`${API}/projects/${P1}/tasks`, () =>
        errorResponse('VALIDATION_FAILED', 400, {
          details: [{ path: 'assigneeEmployeeId', code: 'assignee_not_on_project', message: 'x' }],
        }),
      ),
    );
    await renderApp('/tasks?project=' + P1);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New task' }));
    const form = screen.getByRole('form', { name: 'New task' });
    await user.type(within(form).getByLabelText('Title'), 'x');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(
      await within(form).findByText('Only people on the project can be given its tasks.'),
    ).toBeInTheDocument();
  });

  it('edits only what changed, and deletes', async () => {
    as('manager');
    const calls = serve([task(1)]);
    await renderApp('/tasks');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit task' });
    const title = within(form).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Renamed');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.patch).toEqual([{ title: 'Renamed' }]));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.del).toEqual([uuid(501)]));
  });
});

describe('on the project page', () => {
  it('shows the number of open tasks and links to them', async () => {
    as('manager');
    serve([task(1), task(2)]);
    server.use(http.get(`${API}/projects/${P1}`, () => HttpResponse.json(detail)));
    await renderApp(`/projects/${P1}`);
    expect(await screen.findByText('2 open tasks')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the tasks' })).toHaveAttribute(
      'href',
      `/tasks?project=${P1}`,
    );
  });

  it('is hidden from people who cannot see tasks', async () => {
    server.use(...signedInHandlers(userWithPermissions({ 'project.view': 'own' })));
    serve([task(1)]);
    await renderApp(`/projects/${P1}`);
    await screen.findByRole('heading', { name: 'Website' });
    expect(screen.queryByRole('link', { name: 'Open the tasks' })).not.toBeInTheDocument();
  });
});

describe('drag and drop on the board', () => {
  const transfer = () => {
    const data: Record<string, string> = {};
    return {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => void (data[type] = value),
      getData: (type: string) => data[type] ?? '',
    };
  };
  const column = async (heading: RegExp) =>
    (await screen.findByRole('heading', { name: heading })).closest('section')!;
  const card = (title: string) => screen.getByText(title).closest('li')!;
  const dragTo = (from: HTMLElement, to: HTMLElement) => {
    const dataTransfer = transfer();
    fireEvent.dragStart(from, { dataTransfer });
    fireEvent.dragEnter(to, { dataTransfer });
    fireEvent.dragOver(to, { dataTransfer });
    fireEvent.drop(to, { dataTransfer });
    fireEvent.dragEnd(from, { dataTransfer });
  };

  it('moves a card to the column it is dropped on, with the same request as the select', async () => {
    as('manager');
    const calls = serve([task(1), task(2, { status: 'in_progress' })]);
    await renderApp('/tasks?view=board');
    const done = await column(/^Done/);
    dragTo(card('Task 1'), done);
    // the card waits in its new column while the request runs
    expect(within(done).getByText('Task 1')).toBeInTheDocument();
    await waitFor(() => expect(calls.patch).toEqual([{ status: 'done' }]));
    expect(await screen.findByText('WEB-1 moved to Done')).toBeInTheDocument();
  });

  it('keeps the status select on every movable card', async () => {
    as('manager');
    serve([task(1)]);
    await renderApp('/tasks?view=board');
    await column(/^To do/);
    expect(screen.getByLabelText('Status of WEB-1')).toBeInTheDocument();
    expect(card('Task 1')).toHaveAttribute('draggable', 'true');
  });

  it('does not let a card be picked up when the person cannot move it', async () => {
    as('employee');
    const calls = serve([task(1, { canEdit: false, canMove: false })]);
    await renderApp('/tasks?view=board');
    const done = await column(/^Done/);
    expect(card('Task 1')).toHaveAttribute('draggable', 'false');
    dragTo(card('Task 1'), done);
    expect(within(done).queryByText('Task 1')).not.toBeInTheDocument();
    expect(calls.patch).toEqual([]);
  });

  it('sends nothing when a card is dropped back on its own column', async () => {
    as('manager');
    const calls = serve([task(1)]);
    await renderApp('/tasks?view=board');
    dragTo(card('Task 1'), await column(/^To do/));
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.patch).toEqual([]);
  });

  it('puts the card back and shows the error when the move is refused', async () => {
    as('manager');
    serve([task(1)]);
    server.use(http.patch(`${API}/tasks/:id`, () => errorResponse('FORBIDDEN', 403)));
    await renderApp('/tasks?view=board');
    const done = await column(/^Done/);
    dragTo(card('Task 1'), done);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(within(done).queryByText('Task 1')).not.toBeInTheDocument());
    expect(within(await column(/^To do/)).getByText('Task 1')).toBeInTheDocument();
  });
});
