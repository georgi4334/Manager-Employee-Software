import {
  addDays,
  todayIn,
  type ChecklistDetail,
  type ChecklistSummary,
  type ChecklistTemplate,
  type MyChecklistItem,
} from '@intime/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { initTestI18n } from '@/tests/i18n';
import { API, errorResponse, server, signedInHandlers, userWithRole } from '@/tests/server';
import { renderApp } from '@/tests/utils';

const uuid = (n: number) => `0192f5a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const EVA = { id: uuid(1), firstName: 'Eva', lastName: 'Martin' };
const MIA = { id: uuid(2), firstName: 'Mia', lastName: 'Lead' };
const today = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);

const item = (n: number, o: Partial<ChecklistDetail['items'][number]> = {}) => ({
  id: uuid(100 + n),
  title: `Step ${n}`,
  description: null,
  responsible: 'manager' as const,
  assignee: MIA,
  dueDate: addDays(today, 10),
  done: false,
  doneAt: null,
  doneBy: null,
  canTick: true,
  ...o,
});

const detail = (o: Partial<ChecklistDetail> = {}): ChecklistDetail => ({
  id: uuid(50),
  employee: EVA,
  kind: 'onboarding',
  name: 'Standard',
  anchorDate: today,
  status: 'open',
  done: 1,
  total: 3,
  overdue: 1,
  createdAt: '2026-11-01T08:00:00Z',
  items: [
    item(1, {
      title: 'Sign the contract',
      responsible: 'hr',
      assignee: null,
      dueDate: addDays(today, -2),
    }),
    item(2, { title: 'Welcome lunch', dueDate: today }),
    item(3, {
      title: 'Read the handbook',
      responsible: 'employee',
      assignee: EVA,
      done: true,
      doneAt: '2026-11-02T10:00:00Z',
      doneBy: EVA,
    }),
  ],
  completedAt: null,
  cancelledAt: null,
  canManage: true,
  ...o,
});

const summary = (o: Partial<ChecklistSummary> = {}): ChecklistSummary => ({
  id: uuid(50),
  employee: EVA,
  kind: 'onboarding',
  name: 'Standard',
  anchorDate: today,
  status: 'open',
  done: 1,
  total: 4,
  overdue: 2,
  createdAt: '2026-11-01T08:00:00Z',
  ...o,
});

const template = (o: Partial<ChecklistTemplate> = {}): ChecklistTemplate => ({
  id: uuid(70),
  name: 'Standard onboarding',
  kind: 'onboarding',
  isDefault: true,
  items: [{ id: uuid(71), title: 'Laptop', description: null, responsible: 'hr', offsetDays: -3 }],
  canEdit: true,
  ...o,
});

const mine = (o: Partial<MyChecklistItem> = {}): MyChecklistItem => ({
  ...item(9, { title: 'Order a laptop', dueDate: addDays(today, -1) }),
  checklist: { id: uuid(50), kind: 'onboarding', employee: EVA },
  mine: true,
  ...o,
});

interface Served {
  detail?: ChecklistDetail;
  list?: ChecklistSummary[];
  templates?: ChecklistTemplate[];
  mine?: MyChecklistItem[];
}

function serve(o: Served = {}) {
  const calls = {
    ticks: [] as { url: string; body: unknown }[],
    posts: [] as { url: string; body: unknown }[],
    puts: [] as { url: string; body: unknown }[],
    patches: [] as { url: string; body: unknown }[],
    deletes: [] as string[],
    lists: [] as URL[],
  };
  const current = o.detail ?? detail();
  server.use(
    http.get(`${API}/checklists/my-items`, () => HttpResponse.json({ items: o.mine ?? [] })),
    http.get(`${API}/checklists`, ({ request }) => {
      calls.lists.push(new URL(request.url));
      const items = o.list ?? [];
      return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 25 });
    }),
    http.get(`${API}/checklists/:id`, ({ params }) =>
      params.id === current.id ? HttpResponse.json(current) : errorResponse('NOT_FOUND', 404),
    ),
    http.put(`${API}/checklists/:id/items/:itemId/done`, async ({ request }) => {
      calls.ticks.push({ url: request.url, body: await request.json() });
      return HttpResponse.json(current);
    }),
    http.post(`${API}/checklists/:id/cancel`, ({ request }) => {
      calls.posts.push({ url: request.url, body: null });
      return HttpResponse.json({
        ...current,
        status: 'cancelled',
        cancelledAt: '2026-11-03T08:00:00Z',
      });
    }),
    http.post(`${API}/checklists/:id/items`, async ({ request }) => {
      calls.posts.push({ url: request.url, body: await request.json() });
      return HttpResponse.json(current, { status: 201 });
    }),
    http.patch(`${API}/checklists/:id/items/:itemId`, async ({ request }) => {
      calls.patches.push({ url: request.url, body: await request.json() });
      return HttpResponse.json(current);
    }),
    http.post(`${API}/checklists`, async ({ request }) => {
      calls.posts.push({ url: request.url, body: await request.json() });
      return HttpResponse.json(current, { status: 201 });
    }),
    http.get(`${API}/checklist-templates`, () =>
      HttpResponse.json({ items: o.templates ?? [template()] }),
    ),
    http.get(`${API}/checklist-templates/:id`, ({ params }) => {
      const found = (o.templates ?? [template()]).find((t) => t.id === params.id);
      return found ? HttpResponse.json(found) : errorResponse('NOT_FOUND', 404);
    }),
    http.post(`${API}/checklist-templates`, async ({ request }) => {
      calls.posts.push({ url: request.url, body: await request.json() });
      return HttpResponse.json(template(), { status: 201 });
    }),
    http.put(`${API}/checklist-templates/:id`, async ({ request }) => {
      calls.puts.push({ url: request.url, body: await request.json() });
      return HttpResponse.json(template());
    }),
    http.delete(`${API}/checklist-templates/:id`, ({ request }) => {
      calls.deletes.push(request.url);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${API}/org/chart`, () =>
      HttpResponse.json({
        nodes: [EVA, MIA].map((p) => ({
          ...p,
          jobTitle: null,
          managerId: null,
          departmentId: null,
        })),
      }),
    ),
  );
  return calls;
}

const main = () => within(screen.getByRole('main'));

describe('checklists page', () => {
  it('shows an employee only their to-dos, and ticks one', async () => {
    const calls = serve({
      mine: [mine(), mine({ id: uuid(110), title: 'Badge photo', mine: false })],
    });
    await renderApp('/checklists');
    expect(main().getByRole('heading', { level: 1, name: 'Checklists' })).toBeInTheDocument();
    // one section only: no tab list
    expect(main().queryByRole('button', { name: 'People' })).toBeNull();
    const list = await main().findByRole('list', { name: 'My to-dos' });
    const row = within(list).getByText('Order a laptop').closest('li')!;
    expect(row).toHaveTextContent('Onboarding of Eva Martin');
    expect(row).toHaveTextContent('Overdue');
    expect(within(list).getByText('Badge photo').closest('li')).toHaveTextContent('for HR');
    await userEvent
      .setup()
      .click(within(row).getByRole('checkbox', { name: 'Mark “Order a laptop” as done' }));
    await waitFor(() => expect(calls.ticks).toHaveLength(1));
    expect(calls.ticks[0]!.url).toContain(`/checklists/${uuid(50)}/items/${uuid(109)}/done`);
    expect(calls.ticks[0]!.body).toEqual({ done: true });
  });

  it('says so when nothing waits', async () => {
    serve();
    await renderApp('/checklists');
    expect(await main().findByText('Nothing is waiting for you.')).toBeInTheDocument();
  });

  it('lists checklists of people for a manager, filters and starts one', async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    const calls = serve({ list: [summary()] });
    await renderApp('/checklists?tab=people');
    const list = await main().findByRole('list', { name: 'People' });
    const card = within(list).getByRole('link', { name: 'Eva Martin' }).closest('li')!;
    expect(card).toHaveTextContent('1 of 4 done');
    expect(card).toHaveTextContent('2 overdue');
    expect(within(list).getByRole('link', { name: 'Eva Martin' })).toHaveAttribute(
      'href',
      `/checklists/${uuid(50)}`,
    );
    const user = userEvent.setup();
    await user.selectOptions(main().getByLabelText('Kind'), 'offboarding');
    await waitFor(() => expect(calls.lists.at(-1)?.searchParams.get('kind')).toBe('offboarding'));
    // managers see no Templates section
    expect(main().queryByRole('button', { name: 'Templates' })).toBeNull();

    await user.click(main().getByRole('button', { name: 'Start a checklist' }));
    await user.click(main().getByRole('button', { name: 'Start' }));
    expect(await main().findAllByText('This field is required.')).toHaveLength(2);
    await user.selectOptions(main().getByLabelText('Person'), EVA.id);
    await user.selectOptions(main().getByLabelText('Template'), uuid(70));
    await user.click(main().getByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(calls.posts.at(-1)?.body).toEqual({ employeeId: EVA.id, templateId: uuid(70) }),
    );
  });

  it('says which rule a start broke', async () => {
    server.use(...signedInHandlers(userWithRole('hr')));
    serve({ list: [] });
    server.use(
      http.post(`${API}/checklists`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'open' } }),
      ),
    );
    await renderApp('/checklists?tab=people');
    const user = userEvent.setup();
    await user.click(await main().findByRole('button', { name: 'Start a checklist' }));
    await user.selectOptions(main().getByLabelText('Person'), EVA.id);
    await user.selectOptions(main().getByLabelText('Template'), uuid(70));
    await user.click(main().getByRole('button', { name: 'Start' }));
    expect(
      await main().findByText('This person already has an open checklist of this kind.'),
    ).toBeInTheDocument();
  });

  it('shows HR the templates with a link to a new one', async () => {
    server.use(...signedInHandlers(userWithRole('hr')));
    serve({
      templates: [
        template(),
        template({
          id: uuid(80),
          name: 'Leaving',
          kind: 'offboarding',
          isDefault: false,
          items: [],
        }),
      ],
    });
    await renderApp('/checklists?tab=templates');
    const list = await main().findByRole('list', { name: 'Templates' });
    const first = within(list).getByRole('link', { name: 'Standard onboarding' }).closest('li')!;
    expect(first).toHaveTextContent('Starts automatically');
    expect(first).toHaveTextContent('1 step');
    expect(within(list).getByRole('link', { name: 'Leaving' }).closest('li')).toHaveTextContent(
      '0 steps',
    );
    expect(main().getByRole('link', { name: 'New template' })).toHaveAttribute(
      'href',
      '/checklists/templates/new',
    );
  });
});

describe('checklist page', () => {
  it('shows the steps by due date with states, progress and who did them', async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    serve();
    await renderApp(`/checklists/${uuid(50)}`);
    expect(
      await main().findByRole('heading', { level: 1, name: 'Eva Martin' }),
    ).toBeInTheDocument();
    expect(main().getByText('1 of 3 done')).toBeInTheDocument();
    const steps = within(main().getByRole('list', { name: 'Steps' })).getAllByRole('listitem');
    expect(steps.map((s) => s.querySelector('p')?.textContent)).toEqual([
      'Sign the contract',
      'Welcome lunch',
      'Read the handbook',
    ]);
    expect(steps[0]).toHaveTextContent('HR group');
    expect(steps[0]).toHaveTextContent('Overdue');
    expect(steps[1]).toHaveTextContent('Due soon');
    expect(steps[2]).toHaveTextContent('Done by Eva Martin');
    expect(within(steps[2]!).getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  });

  it('ticks and unticks a step', async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    const calls = serve();
    await renderApp(`/checklists/${uuid(50)}`);
    const user = userEvent.setup();
    await user.click(
      await main().findByRole('checkbox', { name: 'Mark “Read the handbook” as not done' }),
    );
    await waitFor(() => expect(calls.ticks.at(-1)?.body).toEqual({ done: false }));
    await user.click(main().getByRole('checkbox', { name: 'Mark “Welcome lunch” as done' }));
    await waitFor(() => expect(calls.ticks.at(-1)?.body).toEqual({ done: true }));
  });

  it('does not let a person tick a step that is not theirs, nor edit', async () => {
    serve({
      detail: detail({
        canManage: false,
        items: [item(1, { title: 'Welcome lunch', canTick: false })],
      }),
    });
    await renderApp(`/checklists/${uuid(50)}`);
    expect(
      await main().findByRole('checkbox', { name: 'Mark “Welcome lunch” as done' }),
    ).toBeDisabled();
    expect(main().queryByRole('button', { name: 'Add a step' })).toBeNull();
    expect(main().queryByRole('button', { name: 'Cancel checklist' })).toBeNull();
  });

  it('adds and changes a step, and cancels the checklist after asking', async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    const calls = serve();
    await renderApp(`/checklists/${uuid(50)}`);
    const user = userEvent.setup();
    await user.click(await main().findByRole('button', { name: 'Add a step' }));
    const form = main().getByRole('form', { name: 'Add a step' });
    await user.type(within(form).getByLabelText('Title'), 'Team intro');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.posts.at(-1)?.body).toEqual({
        title: 'Team intro',
        description: null,
        responsible: 'hr',
        dueDate: today,
      }),
    );

    await user.click(main().getByRole('button', { name: 'Edit “Welcome lunch”' }));
    const edit = main().getByRole('form', { name: 'Edit “Welcome lunch”' });
    await user.selectOptions(within(edit).getByLabelText('Assignee'), EVA.id);
    await user.click(within(edit).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.patches.at(-1)?.body).toMatchObject({ assigneeEmployeeId: EVA.id }),
    );

    await user.click(main().getByRole('button', { name: 'Cancel checklist' }));
    expect(main().getByText(/Cancel this checklist\?/)).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: 'Keep it' }));
    expect(calls.posts.some((p) => p.url.endsWith('/cancel'))).toBe(false);
    await user.click(main().getByRole('button', { name: 'Cancel checklist' }));
    await user.click(main().getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() => expect(calls.posts.some((p) => p.url.endsWith('/cancel'))).toBe(true));
  });

  it('says when a checklist is not there', async () => {
    serve();
    await renderApp(`/checklists/${uuid(99)}`);
    expect(
      await main().findByRole('heading', { level: 1, name: 'Checklist not found' }),
    ).toBeInTheDocument();
  });
});

describe('template editor', () => {
  it('creates a template with steps; refuses an empty name and a bad offset', async () => {
    server.use(...signedInHandlers(userWithRole('hr')));
    const calls = serve();
    await renderApp('/checklists/templates/new');
    const user = userEvent.setup();
    expect(
      await main().findByRole('heading', { level: 1, name: 'New template' }),
    ).toBeInTheDocument();
    await user.clear(main().getByLabelText('Days from the date'));
    await user.type(main().getByLabelText('Days from the date'), '500');
    await user.click(main().getByRole('button', { name: 'Save template' }));
    expect(await main().findAllByText('This field is required.')).not.toHaveLength(0);
    expect(calls.posts).toEqual([]);

    await user.type(main().getByLabelText('Name'), 'Welcome');
    await user.type(main().getByLabelText('Title'), 'Laptop');
    await user.clear(main().getByLabelText('Days from the date'));
    await user.type(main().getByLabelText('Days from the date'), '-3');
    await user.click(main().getByRole('button', { name: 'Add a step' }));
    const titles = main().getAllByLabelText('Title');
    await user.type(titles[1]!, 'Lunch');
    await user.click(main().getByRole('button', { name: 'Move “Lunch” up' }));
    await user.click(main().getByLabelText('Start automatically'));
    await user.click(main().getByRole('button', { name: 'Save template' }));
    await waitFor(() =>
      expect(calls.posts.at(-1)?.body).toEqual({
        name: 'Welcome',
        kind: 'onboarding',
        isDefault: true,
        items: [
          { title: 'Lunch', description: null, responsible: 'hr', offsetDays: 0 },
          { title: 'Laptop', description: null, responsible: 'hr', offsetDays: -3 },
        ],
      }),
    );
    expect(await screen.findByRole('list', { name: 'Templates' })).toBeInTheDocument();
  });

  it('changes an existing template', async () => {
    server.use(...signedInHandlers(userWithRole('hr')));
    const calls = serve();
    await renderApp(`/checklists/templates/${uuid(70)}`);
    const user = userEvent.setup();
    const name = await main().findByLabelText('Name');
    expect(name).toHaveValue('Standard onboarding');
    await user.click(main().getByRole('button', { name: 'Remove “Laptop”' }));
    await user.click(main().getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(calls.puts.at(-1)?.body).toMatchObject({ items: [] }));
  });

  it('deletes a template after asking', async () => {
    server.use(...signedInHandlers(userWithRole('hr')));
    const calls = serve();
    await renderApp(`/checklists/templates/${uuid(70)}`);
    const user = userEvent.setup();
    await user.click(await main().findByRole('button', { name: 'Delete template' }));
    await user.click(main().getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(calls.deletes).toHaveLength(1));
  });

  it('is not open to people without the permission', async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    serve();
    await renderApp('/checklists/templates/new');
    expect(main().getByRole('heading', { level: 1, name: 'No access' })).toBeInTheDocument();
  });
});

describe('translations', () => {
  it.each([
    ['de', 'Checklisten', 'Nichts wartet auf Sie.'],
    ['bg', 'Чеклисти', 'Нищо не ви чака.'],
  ] as const)('is translated (%s)', async (language, title, empty) => {
    await initTestI18n(language);
    serve();
    await renderApp('/checklists');
    expect(main().getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(await main().findByText(empty)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/checklists:|mine\.|tabs\./);
  });
});
