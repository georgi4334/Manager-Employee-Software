import type { GoalDetail, GoalSummary } from '@intime/contracts';
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
const DAN = { id: uuid(70), firstName: 'Dan', lastName: 'Dev' };
const TEAM = { id: uuid(80), name: 'Platform' };

const summary = (n: number, o: Partial<GoalSummary> = {}): GoalSummary => ({
  id: uuid(500 + n),
  scope: 'personal',
  owner: DAN,
  team: null,
  title: `Goal ${n}`,
  status: 'active',
  dueDate: null,
  progressPct: 0,
  keyResultCount: 0,
  overdue: false,
  parent: null,
  canEdit: true,
  ...o,
});

const detail = (n: number, o: Partial<GoalDetail> = {}): GoalDetail => ({
  ...summary(n),
  description: null,
  manualProgressPct: 0,
  keyResults: [],
  updates: [],
  children: [],
  ...o,
});

const kr = {
  id: uuid(900),
  title: 'Active users',
  unit: 'users',
  startValue: 0,
  targetValue: 200,
  currentValue: 50,
  progressPct: 25,
};

function serve(items: GoalSummary[] = [], teams = [TEAM]) {
  const calls = {
    list: [] as URL[],
    post: [] as unknown[],
    patch: [] as unknown[],
    del: [] as string[],
  };
  server.use(
    http.get(`${API}/goals/teams`, () => HttpResponse.json({ items: teams })),
    http.get(`${API}/goals`, ({ request }) => {
      calls.list.push(new URL(request.url));
      return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 25 });
    }),
    http.get(`${API}/employees`, () =>
      HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 25 }),
    ),
    http.post(`${API}/goals`, async ({ request }) => {
      calls.post.push(await request.json());
      return HttpResponse.json(detail(9), { status: 201 });
    }),
  );
  return calls;
}

function serveDetail(goal: GoalDetail) {
  const calls = { post: [] as unknown[], patch: [] as unknown[], del: [] as string[] };
  server.use(
    http.get(`${API}/goals`, () =>
      HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 25 }),
    ),
    http.get(`${API}/goals/teams`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/employees`, () =>
      HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 25 }),
    ),
    http.get(`${API}/goals/${goal.id}`, () => HttpResponse.json(goal)),
    http.patch(`${API}/goals/${goal.id}`, async ({ request }) => {
      const body = (await request.json()) as object;
      calls.patch.push(body);
      return HttpResponse.json({ ...goal, ...body });
    }),
    http.delete(`${API}/goals/${goal.id}`, () => {
      calls.del.push(goal.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${API}/goals/${goal.id}/key-results`, async ({ request }) => {
      calls.post.push(await request.json());
      return HttpResponse.json(goal, { status: 201 });
    }),
    http.patch(`${API}/goals/${goal.id}/key-results/:krId`, async ({ request }) => {
      calls.patch.push(await request.json());
      return HttpResponse.json(goal);
    }),
    http.delete(`${API}/goals/${goal.id}/key-results/:krId`, ({ params }) => {
      calls.del.push(String(params.krId));
      return HttpResponse.json(goal);
    }),
    http.post(`${API}/goals/${goal.id}/updates`, async ({ request }) => {
      calls.post.push(await request.json());
      return HttpResponse.json(goal, { status: 201 });
    }),
  );
  return calls;
}
const as = (role: 'employee' | 'manager' | 'hr') =>
  server.use(...signedInHandlers(userWithRole(role)));

describe('access and structure', () => {
  it('is not for people without the goal permission', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    await renderApp('/goals');
    expect(await screen.findByText('No access')).toBeInTheDocument();
    await renderApp('/goals/' + uuid(1));
    expect((await screen.findAllByText('No access')).length).toBeGreaterThan(0);
  });

  it('gives a viewer the list without a way to create', async () => {
    server.use(...signedInHandlers(userWithPermissions({ 'goal.view': 'own' })));
    serve([summary(1, { canEdit: false })]);
    await renderApp('/goals');
    expect(await screen.findByText('Goal 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New goal' })).not.toBeInTheDocument();
  });

  it('is in German and Bulgarian', async () => {
    serve([summary(1)]);
    await initTestI18n('de');
    const { unmount } = await renderApp('/goals');
    expect(await screen.findByRole('heading', { name: 'Ziele' })).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/goals');
    expect(await screen.findByRole('heading', { name: 'Цели' })).toBeInTheDocument();
  });
});

describe('the list', () => {
  it('shows scope, owner or team, due date, key results, progress in words and the overdue flag', async () => {
    as('manager');
    serve([
      summary(1, { progressPct: 40, keyResultCount: 2, dueDate: '2026-01-02', overdue: true }),
      summary(2, { scope: 'team', team: TEAM, progressPct: 100 }),
      summary(3, { scope: 'company', progressPct: 0 }),
    ]);
    await renderApp('/goals');
    await screen.findByText('Goal 1');
    // grouped, widest first: company, team, personal
    const rows = within(await screen.findByRole('main')).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.querySelector('a')?.textContent)).toEqual([
      'Goal 3',
      'Goal 2',
      'Goal 1',
    ]);
    const [company, team, personal] = rows;
    expect(personal).toHaveTextContent('Personal');
    expect(personal).toHaveTextContent('Dan Dev');
    expect(personal).toHaveTextContent('2 key results');
    expect(personal).toHaveTextContent('40 %');
    expect(personal).toHaveTextContent('Overdue');
    expect(personal).toHaveTextContent('Active');
    expect(personal).toHaveTextContent('due 2 Jan 2026');
    expect(within(personal!).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(team).toHaveTextContent('Team');
    expect(team).toHaveTextContent('Platform');
    expect(team).not.toHaveTextContent('Overdue');
    expect(company).toHaveTextContent('Company');
    expect(within(personal!).getByRole('link', { name: 'Goal 1' })).toHaveAttribute(
      'href',
      `/goals/${uuid(501)}`,
    );
  });

  it('groups the goals by scope with a heading and a count, and leaves out empty groups', async () => {
    as('manager');
    serve([summary(1), summary(2), summary(3, { scope: 'company' })]);
    await renderApp('/goals');
    const company = await screen.findByRole('heading', { name: /Company goals/ });
    expect(company).toHaveTextContent('1');
    const personal = screen.getByRole('heading', { name: /Personal goals/ });
    expect(personal).toHaveTextContent('2');
    expect(screen.queryByRole('heading', { name: /Team goals/ })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: /Personal goals/ })).getAllByRole('listitem'),
    ).toHaveLength(2);
    // the company group comes first
    const order = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(order[0]).toMatch(/Company goals/);
    expect(order[1]).toMatch(/Personal goals/);
  });

  it('shows one plain list without group headings when a single scope is chosen', async () => {
    as('manager');
    serve([summary(1, { scope: 'team', team: TEAM }), summary(2, { scope: 'team', team: TEAM })]);
    await renderApp('/goals?scope=team');
    const list = await screen.findByRole('list', { name: 'Goals' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: /Team goals/ })).not.toBeInTheDocument();
  });

  it('shows what a goal contributes to, and marks done, cancelled and overdue goals differently', async () => {
    as('manager');
    serve([
      summary(1, {
        parent: { id: uuid(777), title: 'Grow the company', scope: 'company' },
        progressPct: 30,
      }),
      summary(2, { status: 'done', progressPct: 100 }),
      summary(3, { status: 'cancelled' }),
      summary(4, { overdue: true, dueDate: '2026-01-02', progressPct: 10 }),
    ]);
    await renderApp('/goals');
    await screen.findByText('Goal 1');
    const row = (title: string) => screen.getByRole('link', { name: title }).closest('li')!;
    expect(row('Goal 1')).toHaveTextContent('Contributes to: Grow the company');
    const fill = (title: string) =>
      within(row(title)).getByRole('progressbar').firstElementChild as HTMLElement;
    expect(fill('Goal 1').className).toContain('bg-primary');
    expect(fill('Goal 2').className).toContain('bg-success');
    expect(fill('Goal 3').className).toContain('bg-muted-foreground');
    expect(fill('Goal 4').className).toContain('bg-danger');
    expect(row('Goal 2')).toHaveTextContent('Done');
    expect(row('Goal 3')).toHaveTextContent('Cancelled');
    expect(screen.getByRole('link', { name: 'Goal 3' }).className).toContain('line-through');
    expect(row('Goal 1')).not.toHaveTextContent('Overdue');
  });

  it('keeps the bar inside its track for odd percentages', async () => {
    as('manager');
    serve([summary(1, { progressPct: 130 }), summary(2, { progressPct: -5 })]);
    await renderApp('/goals');
    await screen.findByText('Goal 1');
    const fills = screen
      .getAllByRole('progressbar')
      .map((bar) => (bar.firstElementChild as HTMLElement).style.width);
    expect(fills).toEqual(['100%', '0%']);
  });

  it('asks for open goals first and passes the scope, status and search to the API', async () => {
    as('manager');
    const calls = serve([summary(1)]);
    await renderApp('/goals');
    await screen.findByText('Goal 1');
    expect(calls.list.at(-1)?.searchParams.get('status')).toBe('open');
    expect(calls.list.at(-1)?.searchParams.get('scope')).toBe('all');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Team' }));
    await user.selectOptions(screen.getByLabelText('Status'), 'done');
    await user.type(screen.getByRole('searchbox'), 'rust');
    await waitFor(() => {
      const url = calls.list.at(-1)!.searchParams;
      expect([url.get('scope'), url.get('status'), url.get('q')]).toEqual(['team', 'done', 'rust']);
    });
    expect(screen.getByRole('button', { name: 'Team' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('says so when there are no goals, and when loading fails', async () => {
    as('manager');
    serve([]);
    await renderApp('/goals');
    expect(await screen.findByText('No goals to show.')).toBeInTheDocument();
    server.use(http.get(`${API}/goals`, () => errorResponse('INTERNAL_ERROR', 500)));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Company' }));
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('creating a goal', () => {
  it('creates a personal goal and opens it', async () => {
    as('employee');
    const calls = serve();
    server.use(http.get(`${API}/goals/${uuid(509)}`, () => HttpResponse.json(detail(9))));
    await renderApp('/goals');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New goal' }));
    const form = screen.getByRole('form', { name: 'New goal' });
    await user.type(within(form).getByLabelText('Title'), ' Learn Rust ');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.post).toEqual([
        { scope: 'personal', title: 'Learn Rust', status: 'active', progressPct: 0 },
      ]),
    );
    expect(await screen.findByRole('heading', { name: 'Goal 9' })).toBeInTheDocument();
  });

  it('offers only the kinds of goals the person may set', async () => {
    as('employee');
    serve([], []);
    await renderApp('/goals');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New goal' }));
    const kinds = within(screen.getByLabelText('Kind of goal')).getAllByRole('option');
    expect(kinds.map((o) => o.textContent)).toEqual(['Personal']);
  });

  it('lets HR set team and company goals, and asks for the team', async () => {
    as('hr');
    const calls = serve();
    await renderApp('/goals');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New goal' }));
    const form = screen.getByRole('form', { name: 'New goal' });
    expect(
      within(within(form).getByLabelText('Kind of goal'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Personal', 'Team', 'Company']);
    await user.selectOptions(within(form).getByLabelText('Kind of goal'), 'team');
    await user.type(within(form).getByLabelText('Title'), 'Ship v2');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText('This field is required.')).toBeInTheDocument();
    expect(calls.post).toEqual([]);
    await user.selectOptions(within(form).getByLabelText('Team'), TEAM.id);
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.post).toHaveLength(1));
    expect(calls.post[0]).toMatchObject({ scope: 'team', teamId: TEAM.id, title: 'Ship v2' });
  });

  it('does not send an invalid form', async () => {
    as('employee');
    const calls = serve();
    await renderApp('/goals');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New goal' }));
    const form = screen.getByRole('form', { name: 'New goal' });
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText('This field is required.')).toBeInTheDocument();
    await user.type(within(form).getByLabelText('Title'), 'x');
    await user.clear(within(form).getByLabelText('Progress in percent'));
    await user.type(within(form).getByLabelText('Progress in percent'), '150');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(
      await within(form).findByText('Enter a whole number from 0 to 100.'),
    ).toBeInTheDocument();
    expect(calls.post).toEqual([]);
  });

  it('only offers wider goals as the parent', async () => {
    as('employee');
    serve([
      summary(1, { scope: 'personal', title: 'Mine' }),
      summary(2, { scope: 'team', team: TEAM, title: 'Platform goal' }),
      summary(3, { scope: 'company', title: 'Company goal' }),
    ]);
    await renderApp('/goals');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New goal' }));
    const parent = screen.getByLabelText('Contributes to');
    await waitFor(() =>
      expect(
        within(parent)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['No parent goal', 'Platform goal (Team)', 'Company goal (Company)']),
    );
  });

  it('says exactly what the server refused', async () => {
    as('employee');
    serve();
    server.use(
      http.post(`${API}/goals`, () =>
        errorResponse('VALIDATION_FAILED', 400, {
          details: [{ path: 'parentGoalId', code: 'parent_not_wider', message: 'x' }],
        }),
      ),
    );
    await renderApp('/goals');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New goal' }));
    await user.type(screen.getByLabelText('Title'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('A goal can only contribute to a wider goal.'),
    ).toBeInTheDocument();
  });
});

describe('a goal', () => {
  it('shows progress, key results, alignment, children and check-ins', async () => {
    as('employee');
    const goal = detail(1, {
      description: 'By the summer',
      progressPct: 25,
      keyResultCount: 1,
      keyResults: [kr],
      parent: { id: uuid(600), title: 'Company growth', scope: 'company' },
      children: [
        { id: uuid(601), title: 'Sub goal', scope: 'personal', status: 'active', progressPct: 10 },
      ],
      updates: [
        {
          id: uuid(700),
          author: DAN,
          progressPct: 25,
          comment: 'Good week',
          createdAt: '2026-10-20T10:00:00Z',
        },
      ],
    });
    serveDetail(goal);
    await renderApp(`/goals/${goal.id}`);
    expect(await screen.findByRole('heading', { name: 'Goal 1' })).toBeInTheDocument();
    expect(screen.getByText('By the summer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Company growth' })).toHaveAttribute(
      'href',
      `/goals/${uuid(600)}`,
    );
    expect(screen.getByRole('link', { name: 'Sub goal' })).toBeInTheDocument();
    const item = screen.getByText('Active users').closest('li')!;
    expect(item).toHaveTextContent('From 0 users now at 50 users to 200 users');
    expect(within(item).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('Good week')).toBeInTheDocument();
    // with key results, progress is calculated: no manual progress field when editing
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByLabelText('Progress in percent')).not.toBeInTheDocument();
  });

  it('updates the current value of a key result', async () => {
    as('employee');
    const goal = detail(1, { keyResults: [kr] });
    const calls = serveDetail(goal);
    await renderApp(`/goals/${goal.id}`);
    const form = await screen.findByRole('form', { name: 'Update Active users' });
    const user = userEvent.setup();
    await user.clear(within(form).getByLabelText('Current value'));
    await user.type(within(form).getByLabelText('Current value'), '80,5');
    await user.click(within(form).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(calls.patch).toEqual([{ currentValue: 80.5 }]));
  });

  it('refuses a current value that is not a number, and can remove a key result', async () => {
    as('employee');
    const goal = detail(1, { keyResults: [kr] });
    const calls = serveDetail(goal);
    await renderApp(`/goals/${goal.id}`);
    const form = await screen.findByRole('form', { name: 'Update Active users' });
    const user = userEvent.setup();
    await user.clear(within(form).getByLabelText('Current value'));
    await user.click(within(form).getByRole('button', { name: 'Update' }));
    expect(await within(form).findByText('Enter a number.')).toBeInTheDocument();
    expect(calls.patch).toEqual([]);
    await user.click(within(form).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.del).toEqual([kr.id]));
  });

  it('adds a key result, and refuses a target equal to the start', async () => {
    as('employee');
    const goal = detail(1);
    const calls = serveDetail(goal);
    await renderApp(`/goals/${goal.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add a key result' }));
    const form = screen.getByRole('form', { name: 'New key result' });
    await user.type(within(form).getByLabelText('Key result'), 'Users');
    await user.type(within(form).getByLabelText('Target value'), '0');
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    expect(
      await within(form).findByText('The target must differ from the start value.'),
    ).toBeInTheDocument();
    expect(calls.post).toEqual([]);
    await user.clear(within(form).getByLabelText('Target value'));
    await user.type(within(form).getByLabelText('Target value'), '100');
    await user.type(within(form).getByLabelText('Unit (optional)'), 'users');
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(calls.post).toEqual([
        { title: 'Users', unit: 'users', startValue: 0, targetValue: 100 },
      ]),
    );
  });

  it('records a check-in', async () => {
    as('employee');
    const goal = detail(1);
    const calls = serveDetail(goal);
    await renderApp(`/goals/${goal.id}`);
    const form = await screen.findByRole('form', { name: 'New check-in' });
    const user = userEvent.setup();
    await user.type(within(form).getByLabelText('What changed? (optional)'), ' Halfway ');
    await user.click(within(form).getByRole('button', { name: 'Record check-in' }));
    await waitFor(() => expect(calls.post).toEqual([{ comment: 'Halfway' }]));
    expect(screen.getByText('No check-ins yet.')).toBeInTheDocument();
  });

  it('saves only what changed when editing', async () => {
    as('employee');
    const goal = detail(1, { description: 'old' });
    const calls = serveDetail(goal);
    await renderApp(`/goals/${goal.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit goal' });
    await user.selectOptions(within(form).getByLabelText('Status'), 'done');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.patch).toEqual([{ status: 'done' }]));
  });

  it('asks twice before deleting, and says why a goal cannot be deleted', async () => {
    as('employee');
    const goal = detail(1);
    const calls = serveDetail(goal);
    server.use(
      http.delete(`${API}/goals/${goal.id}`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'children' } }),
      ),
    );
    await renderApp(`/goals/${goal.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(calls.del).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Yes, delete this goal' }));
    expect(
      await screen.findByText('Other goals contribute to this one. Remove that link first.'),
    ).toBeInTheDocument();
  });

  it('deletes a goal and returns to the list', async () => {
    as('employee');
    const goal = detail(1);
    const calls = serveDetail(goal);
    await renderApp(`/goals/${goal.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete this goal' }));
    await waitFor(() => expect(calls.del).toEqual([goal.id]));
    expect(await screen.findByRole('heading', { name: 'Goals' })).toBeInTheDocument();
  });

  it('shows no controls when the person cannot change the goal', async () => {
    as('employee');
    const goal = detail(1, { canEdit: false, keyResults: [kr] });
    serveDetail(goal);
    await renderApp(`/goals/${goal.id}`);
    expect(await screen.findByRole('heading', { name: 'Goal 1' })).toBeInTheDocument();
    for (const name of [
      'Edit',
      'Delete',
      'Add a key result',
      'Update',
      'Remove',
      'Record check-in',
    ]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Current value')).not.toBeInTheDocument();
  });

  it('says so when the goal does not exist', async () => {
    as('employee');
    server.use(http.get(`${API}/goals/${uuid(1)}`, () => errorResponse('NOT_FOUND', 404)));
    await renderApp(`/goals/${uuid(1)}`);
    expect(
      await screen.findByText('This goal does not exist or you cannot see it.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to goals' })).toBeInTheDocument();
  });
});
