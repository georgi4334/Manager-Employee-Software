import type {
  CalendarEvent,
  FeedbackItem,
  LeaveRequest,
  ReviewSummary,
  Timesheet,
} from '@intime/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { initTestI18n } from '@/tests/i18n';
import { event, leave, reported, review, sheet, step, uuid } from '@/tests/inbox-fixtures';
import {
  API,
  errorResponse,
  server,
  signedInHandlers,
  userWithPermissions,
  userWithRole,
} from '@/tests/server';
import { renderApp } from '@/tests/utils';

const EVA = { id: uuid(80), firstName: 'Eva', lastName: 'Martin' };
const TOM = { id: uuid(81), firstName: 'Tom', lastName: 'Berg' };

interface Lists {
  leave?: LeaveRequest[];
  sheets?: Timesheet[];
  mine?: ReviewSummary[];
  team?: ReviewSummary[];
  reported?: FeedbackItem[];
  events?: CalendarEvent[];
}

const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 100 });

/** Serves the lists; a decision removes the item, like the API's next answer would. */
function serve(lists: Lists, fail: { leave?: string[] } = {}) {
  const state = { ...lists };
  const calls = { decisions: [] as string[], responses: [] as unknown[] };
  server.use(
    http.get(`${API}/leave/requests`, () => HttpResponse.json(page(state.leave ?? []))),
    http.get(`${API}/time/timesheets`, () => HttpResponse.json(page(state.sheets ?? []))),
    http.get(`${API}/reviews`, ({ request }) =>
      HttpResponse.json(
        page(
          new URL(request.url).searchParams.get('box') === 'team'
            ? (state.team ?? [])
            : (state.mine ?? []),
        ),
      ),
    ),
    http.get(`${API}/feedback`, () => HttpResponse.json(page(state.reported ?? []))),
    http.get(`${API}/calendar/events`, () => HttpResponse.json({ items: state.events ?? [] })),
    http.post(`${API}/leave/requests/:id/:action`, ({ params }) => {
      const id = params.id as string;
      calls.decisions.push(`leave:${id}:${params.action as string}`);
      if (fail.leave?.includes(id)) return errorResponse('CONFLICT', 409);
      const found = state.leave?.find((r) => r.id === id);
      state.leave = state.leave?.filter((r) => r.id !== id);
      return HttpResponse.json({
        ...found,
        status: params.action === 'approve' ? 'approved' : 'rejected',
      });
    }),
    http.post(`${API}/time/timesheets/:id/:action`, ({ params }) => {
      const id = params.id as string;
      calls.decisions.push(`sheet:${id}:${params.action as string}`);
      const found = state.sheets?.find((s) => s.id === id);
      state.sheets = state.sheets?.filter((s) => s.id !== id);
      return HttpResponse.json({
        ...found,
        status: params.action === 'approve' ? 'approved' : 'rejected',
      });
    }),
    http.put(`${API}/calendar/events/:id/response`, async ({ params, request }) => {
      calls.responses.push({ id: params.id, ...((await request.json()) as object) });
      const found = state.events?.find((e) => e.id === params.id);
      state.events = state.events?.filter((e) => e.id !== params.id);
      return HttpResponse.json({ ...found, myResponse: 'accepted' });
    }),
  );
  return calls;
}

const main = () => within(screen.getByRole('main'));

describe('Waiting for me', () => {
  it('lists everything waiting, grouped, with counts in the filter', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    serve({
      leave: [leave(1, { employee: EVA })],
      sheets: [sheet(1, { employee: TOM })],
      mine: [review(1)],
      team: [review(2, { employee: EVA, managerSubmitted: false, managerOverdue: true })],
      reported: [reported(1)],
      events: [event(1, { title: 'Roadmap' })],
    });
    await renderApp('/inbox');
    expect(main().getByRole('heading', { level: 1, name: 'Waiting for me' })).toBeInTheDocument();
    const leaveList = await main().findByRole('list', { name: /Leave requests/ });
    expect(within(leaveList).getByText(/Eva Martin · Annual leave/)).toBeInTheDocument();
    expect(main().getByRole('list', { name: /Timesheets/ })).toHaveTextContent('Tom Berg');
    const reviews = main().getByRole('list', { name: /Reviews/ });
    expect(within(reviews).getAllByRole('listitem')[0]).toHaveTextContent(
      'Write the manager review for Eva Martin',
    );
    expect(within(reviews).getAllByRole('listitem')[0]).toHaveTextContent('Late');
    expect(within(reviews).getByRole('link', { name: 'Write your self-review' })).toHaveAttribute(
      'href',
      `/reviews/${uuid(301)}`,
    );
    expect(main().getByRole('list', { name: /Reported feedback/ })).toBeInTheDocument();
    expect(main().getByRole('list', { name: /Invitations/ })).toHaveTextContent(
      'Roadmap · from Dan Dev',
    );
    expect(main().getByRole('button', { name: 'All 6' })).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Reviews 2' })).toBeInTheDocument();
  });

  it('filters by kind and says when a kind is empty', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    serve({ leave: [leave(1, { employee: EVA })], events: [event(1)] });
    await renderApp('/inbox');
    await main().findByRole('list', { name: /Leave requests/ });
    const user = userEvent.setup();
    await user.click(main().getByRole('button', { name: 'Invitations 1' }));
    expect(main().queryByRole('list', { name: /Leave requests/ })).toBeNull();
    expect(main().getByRole('list', { name: /Invitations/ })).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: 'Feedback 0' }));
    expect(main().getByText('Nothing of this kind is waiting for you.')).toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    serve({});
    await renderApp('/inbox');
    expect(await main().findByText('Nothing is waiting for you. Well done.')).toBeInTheDocument();
  });

  it('hides the type of a masked request', async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    serve({ leave: [leave(1, { employee: EVA, leaveType: null, masked: true })] });
    await renderApp('/inbox');
    const list = await main().findByRole('list', { name: /Leave requests/ });
    expect(list).toHaveTextContent('Eva Martin · Absence');
  });

  it('approves one request and announces it', async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    const calls = serve({ leave: [leave(1, { employee: EVA }), leave(2, { employee: TOM })] });
    await renderApp('/inbox');
    const user = userEvent.setup();
    await user.click(await main().findByRole('button', { name: 'Approve leave of Eva Martin' }));
    await waitFor(() => expect(calls.decisions).toEqual([`leave:${uuid(101)}:approve`]));
    expect(await screen.findByText('Approved for Eva Martin')).toBeInTheDocument();
    await waitFor(() =>
      expect(main().queryByRole('button', { name: 'Approve leave of Eva Martin' })).toBeNull(),
    );
    expect(main().getByRole('button', { name: 'Approve leave of Tom Berg' })).toBeInTheDocument();
  });

  it('rejects a week', async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    const calls = serve({ sheets: [sheet(1, { employee: TOM })] });
    await renderApp('/inbox');
    await userEvent
      .setup()
      .click(await main().findByRole('button', { name: 'Reject the week of Tom Berg' }));
    await waitFor(() => expect(calls.decisions).toEqual([`sheet:${uuid(201)}:reject`]));
  });

  it('answers an invitation', async () => {
    const calls = serve({ events: [event(1, { title: 'Roadmap' })] });
    await renderApp('/inbox');
    await userEvent.setup().click(await main().findByRole('button', { name: 'Maybe for Roadmap' }));
    await waitFor(() =>
      expect(calls.responses).toEqual([{ id: uuid(501), response: 'tentative' }]),
    );
    expect(await screen.findByText('Answer sent')).toBeInTheDocument();
  });

  it('marks a checklist step done from the inbox', async () => {
    serve({});
    const ticks: unknown[] = [];
    server.use(
      http.get(`${API}/checklists/my-items`, () =>
        HttpResponse.json({ items: [step(1, { title: 'Order a laptop' })] }),
      ),
      http.put(`${API}/checklists/:id/items/:itemId/done`, async ({ request, params }) => {
        ticks.push({ item: params.itemId, ...((await request.json()) as object) });
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await renderApp('/inbox');
    const list = await main().findByRole('list', { name: /Checklist steps/ });
    expect(within(list).getByText('Order a laptop').closest('li')).toHaveTextContent(
      'Onboarding of Eva Martin',
    );
    await userEvent
      .setup()
      .click(within(list).getByRole('button', { name: 'Mark “Order a laptop” as done' }));
    await waitFor(() => expect(ticks).toEqual([{ item: uuid(601), done: true }]));
    expect(await screen.findByText('“Order a laptop” done')).toBeInTheDocument();
  });

  it('approves the selected leave and weeks in one go', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    const calls = serve({
      leave: [leave(1, { employee: EVA }), leave(2, { employee: TOM })],
      sheets: [sheet(1, { employee: TOM })],
    });
    await renderApp('/inbox');
    const user = userEvent.setup();
    const leaveList = await main().findByRole('list', { name: /Leave requests/ });
    await user.click(within(leaveList).getByRole('checkbox', { name: 'Select Eva Martin' }));
    const sheets = main().getByRole('list', { name: /Timesheets/ });
    await user.click(within(sheets).getByRole('checkbox', { name: 'Select Tom Berg' }));
    const bar = screen.getByRole('region', { name: 'Selected items' });
    expect(bar).toHaveTextContent('2 selected');
    await user.click(within(bar).getByRole('button', { name: 'Approve 2' }));
    await waitFor(() =>
      expect(calls.decisions).toEqual([`leave:${uuid(101)}:approve`, `sheet:${uuid(201)}:approve`]),
    );
    expect(await screen.findByText('2 approved')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Selected items' })).toBeNull();
  });

  it('asks before rejecting in bulk and can be cancelled', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    const calls = serve({ leave: [leave(1, { employee: EVA }), leave(2, { employee: TOM })] });
    await renderApp('/inbox');
    const user = userEvent.setup();
    await user.click(await main().findByRole('checkbox', { name: 'Select Eva Martin' }));
    await user.click(main().getByRole('checkbox', { name: 'Select Tom Berg' }));
    const bar = screen.getByRole('region', { name: 'Selected items' });
    await user.click(within(bar).getByRole('button', { name: 'Reject 2' }));
    expect(bar).toHaveTextContent('Reject 2 items?');
    await user.click(within(bar).getByRole('button', { name: 'Cancel' }));
    expect(calls.decisions).toEqual([]);
    await user.click(within(bar).getByRole('button', { name: 'Reject 2' }));
    await user.click(within(bar).getByRole('button', { name: 'Yes, reject' }));
    await waitFor(() =>
      expect(calls.decisions).toEqual([`leave:${uuid(101)}:reject`, `leave:${uuid(102)}:reject`]),
    );
    expect(await screen.findByText('2 rejected')).toBeInTheDocument();
  });

  it('says how many failed in bulk and keeps going', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    const calls = serve(
      { leave: [leave(1, { employee: EVA }), leave(2, { employee: TOM })] },
      { leave: [uuid(101)] },
    );
    await renderApp('/inbox');
    const user = userEvent.setup();
    await user.click(await main().findByRole('checkbox', { name: 'Select Eva Martin' }));
    await user.click(main().getByRole('checkbox', { name: 'Select Tom Berg' }));
    await user.click(screen.getByRole('button', { name: 'Approve 2' }));
    await waitFor(() => expect(calls.decisions).toHaveLength(2));
    expect(await screen.findByText('1 approved')).toBeInTheDocument();
  });

  it('shows an error with a retry when a list cannot be loaded', async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    serve({});
    server.use(http.get(`${API}/leave/requests`, () => errorResponse('INTERNAL_ERROR', 500)));
    await renderApp('/inbox');
    expect(await main().findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('asks only for the lists the user may read', async () => {
    server.use(...signedInHandlers(userWithPermissions({ 'calendar.manage_own': 'own' })));
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => {
      asked.push(new URL(request.url).pathname);
    });
    serve({ events: [event(1)] });
    await renderApp('/inbox');
    await main().findByRole('list', { name: /Invitations/ });
    server.events.removeAllListeners('request:start');
    expect(asked).toContain('/api/v1/calendar/events');
    for (const path of ['/leave/requests', '/time/timesheets', '/reviews', '/feedback'])
      expect(asked).not.toContain(`/api/v1${path}`);
  });
});

describe('the badge', () => {
  it('shows the total next to the menu entry and in the bottom bar', async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    serve({ leave: [leave(1, { employee: EVA })], events: [event(1)] });
    await renderApp('/');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(
      await within(nav).findByRole('link', { name: /Waiting for me.*2 waiting for you/ }),
    ).toBeInTheDocument();
    const bar = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(
      within(bar).getByRole('link', { name: /Waiting.*2 waiting for you/ }),
    ).toBeInTheDocument();
  });

  it('shows nothing when nothing is waiting', async () => {
    serve({});
    await renderApp('/');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Waiting for me' })).toBeInTheDocument();
  });
});

describe('the dashboard widget', () => {
  it('counts per kind and links to the inbox', async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    server.use(
      http.get(`${API}/dashboard/layout`, () =>
        HttpResponse.json({ widgets: ['waiting'], isDefault: false, canEdit: false }),
      ),
    );
    serve({ leave: [leave(1), leave(2)], events: [event(1)] });
    await renderApp('/');
    const card = (await main().findByRole('heading', { name: 'Waiting for me' })).closest(
      'section',
    )!;
    expect(await within(card).findByText('Leave requests')).toBeInTheDocument();
    expect(within(card).getAllByRole('link')[0]).toHaveAttribute('href', '/inbox');
    expect(card).toHaveTextContent(/Leave requests\s*2/);
    expect(card).toHaveTextContent(/Invitations\s*1/);
  });

  it('says when nothing is waiting', async () => {
    server.use(
      http.get(`${API}/dashboard/layout`, () =>
        HttpResponse.json({ widgets: ['waiting'], isDefault: false, canEdit: false }),
      ),
    );
    serve({});
    await renderApp('/');
    expect(await main().findByText('Nothing is waiting for you.')).toBeInTheDocument();
  });
});

describe('translations', () => {
  it.each([
    ['de', 'Wartet auf mich'],
    ['bg', 'Чака мен'],
  ] as const)('is translated (%s)', async (language, title) => {
    await initTestI18n(language);
    serve({});
    await renderApp('/inbox');
    expect(main().getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/inbox:|filter\.|bulk\./);
  });
});
