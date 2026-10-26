import type { OneOnOneDetail, OneOnOneSummary } from '@intime/contracts';
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
const MIA = { id: uuid(60), firstName: 'Mia', lastName: 'Manager' };
const DAN = { id: uuid(70), firstName: 'Dan', lastName: 'Dev' };
const EVE = { id: uuid(71), firstName: 'Eve', lastName: 'Eng' };

const summary = (n: number, o: Partial<OneOnOneSummary> = {}): OneOnOneSummary => ({
  id: uuid(500 + n),
  other: MIA,
  role: 'employee',
  date: '2026-11-02',
  time: '10:00',
  durationMinutes: 30,
  status: 'scheduled',
  openActionItems: 0,
  ...o,
});

const detail = (n: number, o: Partial<OneOnOneDetail> = {}): OneOnOneDetail => ({
  ...summary(n),
  manager: MIA,
  employee: DAN,
  agenda: null,
  sharedNotes: null,
  privateNotes: null,
  actionItems: [],
  canEdit: true,
  ...o,
});

const people = (items: { relation: 'manager' | 'report'; p: typeof MIA }[]) => ({
  items: items.map(({ relation, p }) => ({ ...p, relation })),
});

function serveList(items: OneOnOneSummary[] = [], who = people([{ relation: 'manager', p: MIA }])) {
  const calls = { list: [] as URL[], post: [] as unknown[] };
  server.use(
    http.get(`${API}/one-on-ones/people`, () => HttpResponse.json(who)),
    http.get(`${API}/one-on-ones`, ({ request }) => {
      calls.list.push(new URL(request.url));
      return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 25 });
    }),
    http.post(`${API}/one-on-ones`, async ({ request }) => {
      calls.post.push(await request.json());
      return HttpResponse.json(detail(9), { status: 201 });
    }),
  );
  return calls;
}

function serveDetail(meeting: OneOnOneDetail) {
  const calls = {
    patch: [] as unknown[],
    post: [] as unknown[],
    itemPatch: [] as unknown[],
    del: [] as string[],
  };
  server.use(
    http.get(`${API}/one-on-ones/people`, () => HttpResponse.json(people([]))),
    http.get(`${API}/one-on-ones`, () =>
      HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 25 }),
    ),
    http.get(`${API}/one-on-ones/${meeting.id}`, () => HttpResponse.json(meeting)),
    http.patch(`${API}/one-on-ones/${meeting.id}`, async ({ request }) => {
      calls.patch.push(await request.json());
      return HttpResponse.json(meeting);
    }),
    http.post(`${API}/one-on-ones/${meeting.id}/action-items`, async ({ request }) => {
      calls.post.push(await request.json());
      return HttpResponse.json(meeting, { status: 201 });
    }),
    http.patch(`${API}/one-on-ones/${meeting.id}/action-items/:itemId`, async ({ request }) => {
      calls.itemPatch.push(await request.json());
      return HttpResponse.json(meeting);
    }),
    http.delete(`${API}/one-on-ones/${meeting.id}/action-items/:itemId`, ({ params }) => {
      calls.del.push(String(params.itemId));
      return HttpResponse.json(meeting);
    }),
  );
  return calls;
}
const as = (role: 'employee' | 'manager' | 'hr') =>
  server.use(...signedInHandlers(userWithRole(role)));

const item = (n: number, o: object = {}) => ({
  id: uuid(900 + n),
  title: `Item ${n}`,
  owner: DAN,
  dueDate: null,
  done: false,
  overdue: false,
  ...o,
});

describe('access and structure', () => {
  it('is not for people without the permission', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    await renderApp('/one-on-ones');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('is open to every role that holds the permission', async () => {
    for (const role of ['employee', 'manager', 'hr'] as const) {
      as(role);
      serveList([summary(1)]);
      const { unmount } = await renderApp('/one-on-ones');
      expect(await screen.findByRole('link', { name: '1:1 with Mia Manager' })).toBeInTheDocument();
      unmount();
    }
  });

  it('is in German and Bulgarian', async () => {
    serveList([summary(1)]);
    await initTestI18n('de');
    const { unmount } = await renderApp('/one-on-ones');
    expect(await screen.findByRole('heading', { name: '1:1-Gespräche' })).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/one-on-ones');
    expect(await screen.findByRole('heading', { name: 'Срещи 1:1' })).toBeInTheDocument();
  });
});

describe('the list', () => {
  it('shows who, when, how long, the status, the open items and your role', async () => {
    as('manager');
    serveList([
      summary(1, { openActionItems: 2 }),
      summary(2, { other: DAN, role: 'manager', status: 'done', durationMinutes: 45 }),
    ]);
    await renderApp('/one-on-ones');
    const rows = within(await screen.findByRole('list', { name: '1:1 meetings' })).getAllByRole(
      'listitem',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('1:1 with Mia Manager');
    expect(rows[0]).toHaveTextContent('10:00');
    expect(rows[0]).toHaveTextContent('30 minutes');
    expect(rows[0]).toHaveTextContent('Planned');
    expect(rows[0]).toHaveTextContent('2 open action items');
    expect(rows[0]).toHaveTextContent('You are the employee');
    expect(rows[1]).toHaveTextContent('1:1 with Dan Dev');
    expect(rows[1]).toHaveTextContent('Held');
    expect(rows[1]).toHaveTextContent('You are the manager');
    expect(rows[1]).not.toHaveTextContent('open action');
  });

  it('asks for upcoming meetings first and switches to the others', async () => {
    as('manager');
    const calls = serveList([summary(1)]);
    await renderApp('/one-on-ones');
    await screen.findByText('1:1 with Mia Manager');
    expect(calls.list.at(-1)?.searchParams.get('status')).toBe('upcoming');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Past' }));
    await waitFor(() => expect(calls.list.at(-1)?.searchParams.get('status')).toBe('past'));
    expect(screen.getByRole('button', { name: 'Past' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(calls.list.at(-1)?.searchParams.get('status')).toBe('all'));
  });

  it('says so when there are no meetings, and when loading fails', async () => {
    as('manager');
    serveList([]);
    await renderApp('/one-on-ones');
    expect(await screen.findByText('No meetings to show.')).toBeInTheDocument();
    server.use(http.get(`${API}/one-on-ones`, () => errorResponse('INTERNAL_ERROR', 500)));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Past' }));
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('explains when there is nobody to meet and offers no way to schedule', async () => {
    as('employee');
    serveList([], people([]));
    await renderApp('/one-on-ones');
    expect(await screen.findByText(/nobody to schedule a 1:1 with/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Schedule a 1:1' })).not.toBeInTheDocument();
  });
});

describe('scheduling', () => {
  it('schedules with your own manager and opens the meeting', async () => {
    as('employee');
    const calls = serveList();
    server.use(http.get(`${API}/one-on-ones/${uuid(509)}`, () => HttpResponse.json(detail(9))));
    await renderApp('/one-on-ones');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Schedule a 1:1' }));
    const form = screen.getByRole('form', { name: 'Schedule a 1:1' });
    expect(within(form).getByLabelText('With')).toHaveDisplayValue('My manager (Mia Manager)');
    await user.type(within(form).getByLabelText('Date'), '2026-11-02');
    await user.type(within(form).getByLabelText('Time'), '10:00');
    await user.click(within(form).getByRole('button', { name: 'Schedule' }));
    await waitFor(() =>
      expect(calls.post).toEqual([{ date: '2026-11-02', time: '10:00', durationMinutes: 30 }]),
    );
    expect(
      await screen.findByRole('heading', { name: '1:1 with Mia Manager' }),
    ).toBeInTheDocument();
  });

  it('lets a manager pick a report', async () => {
    as('manager');
    const calls = serveList(
      [],
      people([
        { relation: 'manager', p: MIA },
        { relation: 'report', p: DAN },
        { relation: 'report', p: EVE },
      ]),
    );
    await renderApp('/one-on-ones');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Schedule a 1:1' }));
    const form = screen.getByRole('form', { name: 'Schedule a 1:1' });
    await user.selectOptions(within(form).getByLabelText('With'), EVE.id);
    await user.type(within(form).getByLabelText('Date'), '2026-11-03');
    await user.type(within(form).getByLabelText('Time'), '14:30');
    await user.clear(within(form).getByLabelText('Length in minutes'));
    await user.type(within(form).getByLabelText('Length in minutes'), '45');
    await user.type(within(form).getByLabelText('Agenda (optional)'), ' Career ');
    await user.click(within(form).getByRole('button', { name: 'Schedule' }));
    await waitFor(() =>
      expect(calls.post).toEqual([
        {
          employeeId: EVE.id,
          date: '2026-11-03',
          time: '14:30',
          durationMinutes: 45,
          agenda: 'Career',
        },
      ]),
    );
  });

  it('does not send an invalid form', async () => {
    as('employee');
    const calls = serveList();
    await renderApp('/one-on-ones');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Schedule a 1:1' }));
    const form = screen.getByRole('form', { name: 'Schedule a 1:1' });
    await user.click(within(form).getByRole('button', { name: 'Schedule' }));
    expect(await within(form).findAllByText('This field is required.')).toHaveLength(2);
    await user.type(within(form).getByLabelText('Date'), '2026-11-02');
    await user.type(within(form).getByLabelText('Time'), '10:00');
    await user.clear(within(form).getByLabelText('Length in minutes'));
    await user.type(within(form).getByLabelText('Length in minutes'), '5');
    await user.click(within(form).getByRole('button', { name: 'Schedule' }));
    expect(
      await within(form).findByText('Enter whole minutes from 15 to 240.'),
    ).toBeInTheDocument();
    expect(calls.post).toEqual([]);
  });

  it('says exactly what the server refused', async () => {
    as('employee');
    serveList();
    server.use(
      http.post(`${API}/one-on-ones`, () =>
        errorResponse('VALIDATION_FAILED', 400, {
          details: [{ path: 'time', code: 'nonexistent_time', message: 'x' }],
        }),
      ),
    );
    await renderApp('/one-on-ones');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Schedule a 1:1' }));
    await user.type(screen.getByLabelText('Date'), '2027-03-28');
    await user.type(screen.getByLabelText('Time'), '03:30');
    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(
      await screen.findByText('This time does not exist on that day (the clocks change).'),
    ).toBeInTheDocument();
  });
});

describe('a meeting', () => {
  it('shows when, status and your private notes only', async () => {
    as('employee');
    const m = detail(1, { agenda: 'Raise', sharedNotes: 'Agreed', privateNotes: 'Only mine' });
    serveDetail(m);
    await renderApp(`/one-on-ones/${m.id}`);
    expect(
      await screen.findByRole('heading', { name: '1:1 with Mia Manager' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Agenda')).toHaveValue('Raise');
    expect(screen.getByLabelText('Shared notes')).toHaveValue('Agreed');
    expect(screen.getByLabelText('Your private notes')).toHaveValue('Only mine');
    expect(screen.getByText(/Only you can see these/)).toBeInTheDocument();
  });

  it('saves only the texts that changed', async () => {
    as('employee');
    const m = detail(1, { agenda: 'Raise', sharedNotes: 'Agreed' });
    const calls = serveDetail(m);
    await renderApp(`/one-on-ones/${m.id}`);
    const form = await screen.findByRole('form', { name: 'Notes' });
    const user = userEvent.setup();
    await user.type(within(form).getByLabelText('Your private notes'), ' my thoughts ');
    await user.click(within(form).getByRole('button', { name: 'Save notes' }));
    await waitFor(() => expect(calls.patch).toEqual([{ privateNotes: 'my thoughts' }]));
  });

  it('says "Saved." even though saving refreshes the meeting and rebuilds the form', async () => {
    as('employee');
    let current = detail(1, { agenda: 'Raise' });
    serveDetail(current);
    server.use(
      http.get(`${API}/one-on-ones/${current.id}`, () => HttpResponse.json(current)),
      http.patch(`${API}/one-on-ones/${current.id}`, async ({ request }) => {
        current = { ...current, ...((await request.json()) as object) };
        return HttpResponse.json(current);
      }),
    );
    await renderApp(`/one-on-ones/${current.id}`);
    const form = await screen.findByRole('form', { name: 'Notes' });
    const user = userEvent.setup();
    await user.type(within(form).getByLabelText('Shared notes'), 'Agreed');
    await user.click(within(form).getByRole('button', { name: 'Save notes' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(screen.getByLabelText('Shared notes')).toHaveValue('Agreed');
  });

  it('clears a text with null', async () => {
    as('employee');
    const m = detail(1, { agenda: 'Raise' });
    const calls = serveDetail(m);
    await renderApp(`/one-on-ones/${m.id}`);
    const form = await screen.findByRole('form', { name: 'Notes' });
    const user = userEvent.setup();
    await user.clear(within(form).getByLabelText('Agenda'));
    await user.click(within(form).getByRole('button', { name: 'Save notes' }));
    await waitFor(() => expect(calls.patch).toEqual([{ agenda: null }]));
  });

  it('sends nothing when nothing changed', async () => {
    as('employee');
    const m = detail(1, { agenda: 'Raise' });
    const calls = serveDetail(m);
    await renderApp(`/one-on-ones/${m.id}`);
    const form = await screen.findByRole('form', { name: 'Notes' });
    await userEvent.setup().click(within(form).getByRole('button', { name: 'Save notes' }));
    await new Promise((r) => setTimeout(r, 100));
    expect(calls.patch).toEqual([]);
  });

  it('changes the time, sending date and time together', async () => {
    as('employee');
    const m = detail(1);
    const calls = serveDetail(m);
    await renderApp(`/one-on-ones/${m.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change the time' }));
    const form = screen.getByRole('form', { name: 'Change the time' });
    await user.clear(within(form).getByLabelText('Time'));
    await user.type(within(form).getByLabelText('Time'), '11:15');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.patch).toEqual([{ date: '2026-11-02', time: '11:15' }]));
  });

  it('marks it done, and asks twice before cancelling', async () => {
    as('employee');
    const m = detail(1);
    const calls = serveDetail(m);
    await renderApp(`/one-on-ones/${m.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Mark as done' }));
    await waitFor(() => expect(calls.patch).toEqual([{ status: 'done' }]));
    await user.click(screen.getByRole('button', { name: 'Cancel the meeting' }));
    expect(calls.patch).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() => expect(calls.patch.at(-1)).toEqual({ status: 'cancelled' }));
  });

  it('is read only once cancelled', async () => {
    as('employee');
    const m = detail(1, {
      status: 'cancelled',
      canEdit: false,
      agenda: 'Old agenda',
      actionItems: [item(1)],
    });
    serveDetail(m);
    await renderApp(`/one-on-ones/${m.id}`);
    expect(await screen.findByText('Old agenda')).toBeInTheDocument();
    expect(
      screen.getByText('This meeting was cancelled and can no longer be changed.'),
    ).toBeInTheDocument();
    for (const name of [
      'Change the time',
      'Mark as done',
      'Cancel the meeting',
      'Save notes',
      'Add',
      'Remove',
    ]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('checkbox', { name: 'Done: Item 1' })).toBeDisabled();
  });

  it('shows the server’s refusal when the meeting was cancelled meanwhile', async () => {
    as('employee');
    const m = detail(1);
    serveDetail(m);
    server.use(
      http.patch(`${API}/one-on-ones/${m.id}`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'status' } }),
      ),
    );
    await renderApp(`/one-on-ones/${m.id}`);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Mark as done' }));
    expect(
      await screen.findByText('This meeting was cancelled and can no longer be changed.'),
    ).toBeInTheDocument();
  });

  it('says so when the meeting does not exist', async () => {
    as('employee');
    server.use(http.get(`${API}/one-on-ones/${uuid(1)}`, () => errorResponse('NOT_FOUND', 404)));
    await renderApp(`/one-on-ones/${uuid(1)}`);
    expect(
      await screen.findByText('This meeting does not exist or you are not part of it.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to 1:1 meetings' })).toBeInTheDocument();
  });
});

describe('action items', () => {
  it('shows owner, due date and the overdue flag, and completes and removes items', async () => {
    as('employee');
    const m = detail(1, {
      actionItems: [
        item(1, { dueDate: '2026-10-01', overdue: true }),
        item(2, { done: true, owner: MIA }),
      ],
    });
    const calls = serveDetail(m);
    await renderApp(`/one-on-ones/${m.id}`);
    const list = await screen.findByRole('list', { name: 'Action items' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Dan Dev');
    expect(rows[0]).toHaveTextContent('overdue');
    expect(rows[1]).toHaveTextContent('Mia Manager');
    expect(within(rows[1]!).getByRole('checkbox')).toBeChecked();
    const user = userEvent.setup();
    await user.click(within(rows[0]!).getByRole('checkbox'));
    await waitFor(() => expect(calls.itemPatch).toEqual([{ done: true }]));
    await user.click(within(rows[1]!).getByRole('button', { name: 'Remove Item 2' }));
    await waitFor(() => expect(calls.del).toEqual([uuid(902)]));
  });

  it('adds an item for the other person with a due date', async () => {
    as('employee');
    const m = detail(1);
    const calls = serveDetail(m);
    await renderApp(`/one-on-ones/${m.id}`);
    const form = await screen.findByRole('form', { name: 'New action item' });
    const user = userEvent.setup();
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    expect(await within(form).findByText('This field is required.')).toBeInTheDocument();
    expect(calls.post).toEqual([]);
    await user.type(within(form).getByLabelText('What needs to be done'), ' Book a room ');
    await user.selectOptions(within(form).getByLabelText('Who'), MIA.id);
    await user.type(within(form).getByLabelText('Due date (optional)'), '2026-11-09');
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(calls.post).toEqual([
        { title: 'Book a room', ownerEmployeeId: MIA.id, dueDate: '2026-11-09' },
      ]),
    );
  });

  it('offers no new item once the meeting holds twenty', async () => {
    as('employee');
    const m = detail(1, { actionItems: Array.from({ length: 20 }, (_, n) => item(n + 1)) });
    serveDetail(m);
    await renderApp(`/one-on-ones/${m.id}`);
    await screen.findByRole('list', { name: 'Action items' });
    expect(screen.queryByRole('form', { name: 'New action item' })).not.toBeInTheDocument();
  });
});
