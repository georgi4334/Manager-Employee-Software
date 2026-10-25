import {
  BUILT_IN_HOLIDAY_KEYS,
  addDays,
  type Employee,
  type Holiday,
  type LeaveBalances,
  type LeaveRequest,
  type LeaveType,
} from '@intime/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import bgLeave from '@/i18n/locales/bg/leave.json';
import deLeave from '@/i18n/locales/de/leave.json';
import enLeave from '@/i18n/locales/en/leave.json';
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
const ANNUAL = uuid(1);
const SICK = uuid(2);
const UNPAID = uuid(3);
const CUSTOM = uuid(4);
const ME = uuid(50);

const type = (id: string, o: Partial<LeaveType>): LeaveType => ({
  id,
  key: null,
  name: null,
  tracksBalance: false,
  requiresApproval: true,
  isSick: false,
  color: 'primary',
  isActive: true,
  allowanceDays: null,
  carryOverMaxDays: null,
  ...o,
});

const TYPES: LeaveType[] = [
  type(ANNUAL, {
    key: 'annual',
    tracksBalance: true,
    color: 'success',
    allowanceDays: 20,
    carryOverMaxDays: 5,
  }),
  type(SICK, { key: 'sick', isSick: true, requiresApproval: false, color: 'warning' }),
  type(UNPAID, { key: 'unpaid', color: 'info' }),
  type(CUSTOM, { name: 'Study leave', color: 'accent' }),
];

const own = (): Employee => ({
  id: ME,
  firstName: 'Maria',
  lastName: 'Ivanova',
  jobTitle: null,
  location: null,
  email: 'maria@acme.eu',
  status: 'active',
  department: null,
  manager: null,
  teams: [],
  isSelf: true,
  profile: null,
});

const request = (n: number, o: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: uuid(100 + n),
  employee: { id: ME, firstName: 'Maria', lastName: 'Ivanova' },
  leaveType: { id: ANNUAL, key: 'annual', name: null, color: 'success', isSick: false },
  masked: false,
  startDate: '2026-11-02',
  endDate: '2026-11-06',
  halfDayStart: false,
  halfDayEnd: false,
  days: 5,
  status: 'pending',
  reason: null,
  decisionComment: null,
  decidedAt: null,
  createdAt: '2026-10-20T08:00:00.000Z',
  canApprove: false,
  canCancel: false,
  ...o,
});

const balances = (o: Partial<LeaveBalances['balances'][number]> = {}): LeaveBalances => ({
  employeeId: ME,
  year: 2026,
  balances: [
    {
      leaveTypeId: ANNUAL,
      year: 2026,
      entitled: 20,
      carriedOver: 2.5,
      adjustment: 0,
      used: 5,
      pending: 3,
      remaining: 14.5,
      ...o,
    },
  ],
});

interface Served {
  requests?: LeaveRequest[];
  balances?: LeaveBalances;
  types?: LeaveType[];
  employee?: Employee | 'none';
}

function serve(o: Served = {}) {
  const calls = { requests: [] as URL[], balances: [] as URL[] };
  server.use(
    http.get(`${API}/employees/me`, () =>
      o.employee === 'none'
        ? errorResponse('NOT_FOUND', 404)
        : HttpResponse.json(o.employee ?? own()),
    ),
    http.get(`${API}/leave/types`, () => HttpResponse.json(o.types ?? TYPES)),
    http.get(`${API}/leave/balances`, ({ request: r }) => {
      calls.balances.push(new URL(r.url));
      return HttpResponse.json(o.balances ?? balances());
    }),
    http.get(`${API}/leave/requests`, ({ request: r }) => {
      calls.requests.push(new URL(r.url));
      const items = o.requests ?? [];
      return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 100 });
    }),
  );
  return calls;
}
const as = (role: 'employee' | 'manager' | 'hr') =>
  server.use(...signedInHandlers(userWithRole(role)));
const FUTURE = '2030-03-04';
const FUTURE_END = '2030-03-08';

// ---------------------------------------------------------------------------------------------------
describe('access and structure', () => {
  it('is not for people without any leave permission', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    await renderApp('/leave');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('shows an employee only their own leave, without tabs', async () => {
    serve();
    await renderApp('/leave');
    expect(await screen.findByRole('heading', { name: 'Leave' })).toBeInTheDocument();
    expect(await screen.findByText('Leave balance')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('shows tabs by permission: managers get approvals and team, HR also settings', async () => {
    as('manager');
    serve();
    const { unmount } = await renderApp('/leave');
    expect((await screen.findAllByRole('tab')).map((tab) => tab.textContent)).toEqual([
      'My leave',
      'Approvals',
      'Team',
    ]);
    unmount();
    as('hr');
    serve();
    await renderApp('/leave');
    expect((await screen.findAllByRole('tab')).map((tab) => tab.textContent)).toEqual([
      'My leave',
      'Approvals',
      'Team',
      'Settings',
    ]);
  });

  it('explains a missing employee record', async () => {
    serve({ employee: 'none' });
    await renderApp('/leave');
    expect(await screen.findByText(/no employee record for your account/)).toBeInTheDocument();
  });

  it('is in German and Bulgarian, with localized numbers', async () => {
    serve();
    await initTestI18n('de');
    const { unmount } = await renderApp('/leave');
    expect(await screen.findByRole('heading', { name: 'Urlaub' })).toBeInTheDocument();
    expect(await screen.findByText('14,5')).toBeInTheDocument(); // decimal comma
    unmount();
    await initTestI18n('bg');
    await renderApp('/leave');
    expect(await screen.findByRole('heading', { name: 'Отпуски' })).toBeInTheDocument();
    expect(await screen.findByText('14,5')).toBeInTheDocument();
  });
});

describe('balances', () => {
  it('shows the figures of the annual balance', async () => {
    serve();
    await renderApp('/leave');
    expect((await screen.findAllByText('Annual leave')).length).toBeGreaterThan(0);
    const figures = screen.getByText('Entitled').closest('dl')!;
    expect(figures).toHaveTextContent('Entitled20');
    expect(figures).toHaveTextContent('Carried over2.5');
    expect(figures).toHaveTextContent('Used5');
    expect(figures).toHaveTextContent('Pending3');
    expect(screen.getByLabelText('Remaining: 14.5')).toBeInTheDocument();
  });

  it('switches the year', async () => {
    const calls = serve();
    await renderApp('/leave');
    await screen.findByText('Entitled');
    const year = Number(calls.balances[0]!.searchParams.get('year'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next year' }));
    await waitFor(() =>
      expect(calls.balances.at(-1)?.searchParams.get('year')).toBe(String(year + 1)),
    );
    expect(await screen.findByText(String(year + 1))).toBeInTheDocument();
  });

  it('says so when no type has a yearly allowance', async () => {
    serve({ balances: { employeeId: ME, year: 2026, balances: [] } });
    await renderApp('/leave');
    expect(await screen.findByText('No leave type with a yearly allowance.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('requesting leave', () => {
  async function fill(
    user: ReturnType<typeof userEvent.setup>,
    typeName: string,
    from = FUTURE,
    to = FUTURE_END,
  ) {
    await screen.findByText('Leave balance');
    await user.selectOptions(await screen.findByLabelText('Type'), typeName);
    await user.type(screen.getByLabelText('From'), from);
    await user.type(screen.getByLabelText('To'), to);
  }

  it('checks the form before sending anything', async () => {
    serve();
    const bodies: unknown[] = [];
    server.use(
      http.post(
        `${API}/leave/requests`,
        async ({ request: r }) => (
          bodies.push(await r.json()),
          HttpResponse.json(request(1), { status: 201 })
        ),
      ),
    );
    await renderApp('/leave');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Send request' }));
    expect(await screen.findAllByText('This field is required.')).toHaveLength(3);
    await user.selectOptions(screen.getByLabelText('Type'), 'Annual leave');
    await user.type(screen.getByLabelText('From'), '2030-03-08');
    await user.type(screen.getByLabelText('To'), '2030-03-04');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('The end cannot be before the start.')).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('shows the counted days and what is left while typing, then sends the request', async () => {
    serve();
    const previews: unknown[] = [];
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/leave/requests/preview`, async ({ request: r }) => {
        previews.push(await r.json());
        return HttpResponse.json({ days: 4.5, dates: [], remainingAfter: 10, enough: true });
      }),
      http.post(`${API}/leave/requests`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(request(1), { status: 201 });
      }),
    );
    await renderApp('/leave');
    const user = userEvent.setup();
    await fill(user, 'Annual leave');
    await user.click(screen.getByLabelText(/Ends at noon/));
    expect(await screen.findByText('4.5 working days will be counted.')).toBeInTheDocument();
    expect(screen.getByText('Remaining after this request: 10')).toBeInTheDocument();
    expect(previews.at(-1)).toEqual({
      leaveTypeId: ANNUAL,
      startDate: FUTURE,
      endDate: FUTURE_END,
      halfDayStart: false,
      halfDayEnd: true,
    });

    await user.type(screen.getByLabelText('Note (optional)'), '  Family trip ');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Request sent. It waits for approval.')).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        leaveTypeId: ANNUAL,
        startDate: FUTURE,
        endDate: FUTURE_END,
        halfDayStart: false,
        halfDayEnd: true,
        reason: 'Family trip',
      },
    ]);
    // the form is empty again, the type stays selected
    expect(screen.getByLabelText('From')).toHaveValue('');
    expect(screen.getByLabelText('Type')).toHaveValue(ANNUAL);
  });

  it('warns when there are too few days left, and when the dates contain no working day', async () => {
    serve();
    let days = 0;
    server.use(
      http.post(`${API}/leave/requests/preview`, () =>
        HttpResponse.json(
          days === 0
            ? { days: 0, dates: [], remainingAfter: null, enough: true }
            : { days: 5, dates: [], remainingAfter: -2, enough: false },
        ),
      ),
    );
    await renderApp('/leave');
    const user = userEvent.setup();
    await fill(user, 'Annual leave');
    expect(await screen.findByText('These dates contain no working day.')).toBeInTheDocument();
    days = 5;
    await user.click(screen.getByLabelText(/Starts at noon/));
    expect(
      await screen.findByText('This is more than the days you have left.'),
    ).toBeInTheDocument();
  });

  it('does not ask for a reason for sick leave, never sends one, and says it is recorded at once', async () => {
    serve();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post(`${API}/leave/requests/preview`, () =>
        HttpResponse.json({ days: 5, dates: [], remainingAfter: null, enough: true }),
      ),
      http.post(`${API}/leave/requests`, async ({ request: r }) => {
        bodies.push((await r.json()) as Record<string, unknown>);
        return HttpResponse.json(request(2, { status: 'approved' }), { status: 201 });
      }),
    );
    await renderApp('/leave');
    const user = userEvent.setup();
    await screen.findByText('Leave balance');
    expect(screen.getByLabelText('Note (optional)')).toBeInTheDocument();
    await fill(user, 'Sick leave');
    expect(screen.queryByLabelText('Note (optional)')).not.toBeInTheDocument();
    expect(screen.getByText(/no reason is stored/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(
      await screen.findByText('Recorded. No approval is needed for this type.'),
    ).toBeInTheDocument();
    expect(bodies[0]).not.toHaveProperty('reason');
    // no balance line for a type without balance
    expect(screen.queryByText(/Remaining after this request/)).not.toBeInTheDocument();
  });

  it.each([
    [
      'not enough days',
      () =>
        errorResponse('INSUFFICIENT_BALANCE', 409, {
          params: { available: 2.5, requested: 5, year: 2030 },
        }),
      'You have 2.5 days left for 2030, but this request needs 5.',
    ],
    [
      'overlapping dates',
      () => errorResponse('CONFLICT', 409, { params: { field: 'dates' } }),
      'These dates overlap another request of yours.',
    ],
    [
      'no working days',
      () => errorResponse('NO_WORKING_DAYS', 400),
      'The chosen dates contain no working day.',
    ],
    [
      'a start in the past',
      () =>
        errorResponse('VALIDATION_FAILED', 400, {
          details: [{ path: 'startDate', code: 'too_far_in_past', message: 'x' }],
        }),
      'The start is too far in the past.',
    ],
  ])('explains %s', async (_label, response, text) => {
    serve();
    server.use(
      http.post(`${API}/leave/requests/preview`, () =>
        HttpResponse.json({ days: 5, dates: [], remainingAfter: 3, enough: true }),
      ),
      http.post(`${API}/leave/requests`, () => response()),
    );
    await renderApp('/leave');
    const user = userEvent.setup();
    await fill(user, 'Annual leave');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toHaveValue(FUTURE); // nothing is lost
  });
});

// ---------------------------------------------------------------------------------------------------
describe('my requests', () => {
  it('lists requests with status, note and comment, newest first', async () => {
    serve({
      requests: [
        request(1, {
          startDate: '2026-11-02',
          endDate: '2026-11-06',
          reason: 'Family trip',
          status: 'rejected',
          decisionComment: 'Busy period',
        }),
        request(2, {
          startDate: '2026-12-21',
          endDate: '2026-12-21',
          days: 0.5,
          status: 'approved',
          leaveType: { id: SICK, key: 'sick', name: null, color: 'warning', isSick: true },
        }),
      ],
    });
    await renderApp('/leave');
    const list = await screen.findByRole('list', { name: 'Leave requests' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('21 Dec 2026');
    expect(rows[0]).toHaveTextContent('Sick leave');
    expect(rows[0]).toHaveTextContent('0.5 days');
    expect(rows[0]).toHaveTextContent('Approved');
    expect(rows[1]).toHaveTextContent('2 Nov 2026 – 6 Nov 2026');
    expect(rows[1]).toHaveTextContent('Note: Family trip');
    expect(rows[1]).toHaveTextContent('Comment: Busy period');
    expect(rows[1]).toHaveTextContent('Rejected');
  });

  it('says so when there are none', async () => {
    serve({ requests: [] });
    await renderApp('/leave');
    expect(await screen.findByText('You have not requested any leave yet.')).toBeInTheDocument();
  });

  it('offers cancel only where the server allows it and sends it', async () => {
    serve({
      requests: [
        request(1, { canCancel: true }),
        request(2, { canCancel: false, status: 'approved' }),
      ],
    });
    let cancelled = '';
    server.use(
      http.post(`${API}/leave/requests/${uuid(101)}/cancel`, () => {
        cancelled = uuid(101);
        return HttpResponse.json(request(1, { status: 'cancelled' }));
      }),
    );
    await renderApp('/leave');
    const buttons = await screen.findAllByRole('button', { name: 'Cancel request' });
    expect(buttons).toHaveLength(1);
    await userEvent.setup().click(buttons[0]!);
    await waitFor(() => expect(cancelled).toBe(uuid(101)));
  });

  it('shows why a cancel failed', async () => {
    serve({ requests: [request(1, { canCancel: true })] });
    server.use(
      http.post(`${API}/leave/requests/${uuid(101)}/cancel`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'status' } }),
      ),
    );
    await renderApp('/leave');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cancel request' }));
    expect(
      await screen.findByText('This request was already decided or closed.'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('approvals', () => {
  const pending = (n: number, name: string, o: Partial<LeaveRequest> = {}) =>
    request(n, {
      employee: { id: uuid(60 + n), firstName: name, lastName: 'Test' },
      canApprove: true,
      canCancel: true,
      reason: 'Trip',
      ...o,
    });

  it('asks the server for what this person may decide and lists it with the note', async () => {
    as('manager');
    const calls = serve({ requests: [pending(1, 'Dan'), pending(2, 'Eve')] });
    await renderApp('/leave?tab=approvals');
    const list = await screen.findByRole('list', { name: 'Waiting for your decision' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('Dan Test')).toBeInTheDocument();
    expect(within(list).getAllByText('Note: Trip')).toHaveLength(2);
    expect(calls.requests.at(-1)?.searchParams.get('approvable')).toBe('true');
  });

  it('shows on demand what the request collides with, never before', async () => {
    as('manager');
    serve({ requests: [pending(1, 'Dan')] });
    let asked = 0;
    server.use(
      http.get(`${API}/leave/requests/${uuid(101)}/conflicts`, () => {
        asked += 1;
        return HttpResponse.json({
          assignments: [
            {
              projectId: uuid(7),
              code: 'WEB-1',
              name: 'Website',
              allocationPct: 40,
              fromDate: '2026-01-01',
              toDate: null,
            },
          ],
          milestones: [
            {
              id: uuid(8),
              projectId: uuid(7),
              code: 'WEB-1',
              title: 'Beta',
              dueDate: '2030-03-05',
            },
          ],
          tasks: [{ id: uuid(9), projectId: uuid(7), key: 'WEB-1-3', dueDate: '2030-03-06' }],
        });
      }),
    );
    await renderApp('/leave?tab=approvals');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', {
      name: 'Check the project impact of the request of Dan Test',
    });
    expect(asked).toBe(0);
    await user.click(button);
    expect(await screen.findByText('WEB-1 · Website (40% of their time)')).toBeInTheDocument();
    expect(screen.getByText(/WEB-1 · Beta/)).toBeInTheDocument();
    expect(screen.getByText(/WEB-1-3/)).toBeInTheDocument();
    expect(asked).toBe(1);
    await user.click(
      screen.getByRole('button', { name: 'Hide the project impact of the request of Dan Test' }),
    );
    expect(screen.queryByText('WEB-1 · Website (40% of their time)')).not.toBeInTheDocument();
  });

  it('says so when nothing is affected, and shows an error when the check fails', async () => {
    as('manager');
    serve({ requests: [pending(1, 'Dan')] });
    server.use(
      http.get(`${API}/leave/requests/${uuid(101)}/conflicts`, () =>
        HttpResponse.json({ assignments: [], milestones: [], tasks: [] }),
      ),
    );
    const { unmount } = await renderApp('/leave?tab=approvals');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: 'Check the project impact of the request of Dan Test',
      }),
    );
    expect(
      await screen.findByText('No projects, milestones or tasks are affected.'),
    ).toBeInTheDocument();
    unmount();

    server.use(
      http.get(`${API}/leave/requests/${uuid(101)}/conflicts`, () =>
        errorResponse('INTERNAL', 500),
      ),
    );
    await renderApp('/leave?tab=approvals');
    await user.click(
      await screen.findByRole('button', {
        name: 'Check the project impact of the request of Dan Test',
      }),
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('offers no impact check on requests the person cannot decide', async () => {
    as('manager');
    serve({ requests: [pending(1, 'Dan', { canApprove: false })] });
    await renderApp('/leave?tab=approvals');
    await screen.findByText('Dan Test');
    expect(screen.queryByRole('button', { name: /project impact/ })).not.toBeInTheDocument();
  });

  it('approves with an optional comment, after a confirmation step', async () => {
    as('manager');
    serve({ requests: [pending(1, 'Dan')] });
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/leave/requests/${uuid(101)}/approve`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(request(1, { status: 'approved' }));
      }),
    );
    await renderApp('/leave?tab=approvals');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(bodies).toEqual([]); // nothing is sent before the confirmation
    await user.type(screen.getByLabelText('Comment (optional)'), '  Enjoy!  ');
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));
    await waitFor(() => expect(bodies).toEqual([{ comment: 'Enjoy!' }]));
  });

  it('rejects without a comment by sending an empty decision', async () => {
    as('manager');
    serve({ requests: [pending(1, 'Dan')] });
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/leave/requests/${uuid(101)}/reject`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(request(1, { status: 'rejected' }));
      }),
    );
    await renderApp('/leave?tab=approvals');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    await waitFor(() => expect(bodies).toEqual([{}]));
  });

  it('shows a refusal, for example when somebody else decided first', async () => {
    as('manager');
    serve({ requests: [pending(1, 'Dan')] });
    server.use(
      http.post(`${API}/leave/requests/${uuid(101)}/approve`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'status' } }),
      ),
    );
    await renderApp('/leave?tab=approvals');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));
    expect(
      await screen.findByText('This request was already decided or closed.'),
    ).toBeInTheDocument();
  });

  it('offers no decision buttons on requests the server does not allow the person to decide', async () => {
    as('manager');
    serve({ requests: [pending(1, 'Dan', { canApprove: false })] });
    await renderApp('/leave?tab=approvals');
    await screen.findByText('Dan Test');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    as('manager');
    serve({ requests: [] });
    await renderApp('/leave?tab=approvals');
    expect(await screen.findByText('No requests are waiting for you.')).toBeInTheDocument();
  });

  it('is not reachable through the address for people who cannot approve', async () => {
    serve();
    await renderApp('/leave?tab=approvals');
    expect(await screen.findByText('Leave balance')).toBeInTheDocument(); // falls back to their own leave
    expect(screen.queryByText('Waiting for your decision')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('team', () => {
  it('lists absences in a period without rejected or cancelled requests, hiding masked types', async () => {
    as('manager');
    const dan = { id: uuid(61), firstName: 'Dan', lastName: 'Test' };
    const calls = serve({
      requests: [
        request(1, { employee: dan, status: 'approved' }),
        request(2, {
          employee: { ...dan, firstName: 'Eve' },
          status: 'approved',
          leaveType: null,
          masked: true,
        }),
        request(3, { employee: { ...dan, firstName: 'Gus' }, status: 'rejected' }),
        request(4, { employee: { ...dan, firstName: 'Hal' }, status: 'cancelled' }),
      ],
    });
    await renderApp('/leave?tab=team');
    const list = await screen.findByRole('list', { name: 'Who is off' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('Eve Test').closest('li')).toHaveTextContent('Absent');
    expect(within(list).getByText('Eve Test').closest('li')).not.toHaveTextContent('Annual leave');
    expect(within(list).getByText('Dan Test').closest('li')).toHaveTextContent('Annual leave');
    const q = calls.requests.at(-1)!.searchParams;
    expect(q.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(q.get('to')).toBe(addDays(q.get('from')!, 30));
  });

  it('sends the chosen period and does not ask for an invalid one', async () => {
    as('manager');
    const calls = serve({ requests: [] });
    await renderApp('/leave?tab=team');
    const user = userEvent.setup();
    expect(await screen.findByText('Nobody is off in this period.')).toBeInTheDocument();
    const before = calls.requests.length;
    await user.clear(screen.getByLabelText('From'));
    await user.type(screen.getByLabelText('From'), '2031-05-01');
    await user.clear(screen.getByLabelText('To'));
    await user.type(screen.getByLabelText('To'), '2031-05-10');
    await waitFor(() => expect(calls.requests.at(-1)?.searchParams.get('to')).toBe('2031-05-10'));
    expect(calls.requests.at(-1)?.searchParams.get('from')).toBe('2031-05-01');
    const asked = calls.requests.length;
    expect(asked).toBeGreaterThan(before);
    await user.clear(screen.getByLabelText('To'));
    await user.type(screen.getByLabelText('To'), '2031-04-01'); // before the start
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.requests.at(-1)?.searchParams.get('to')).not.toBe('2031-04-01');
  });

  it('is not offered to plain employees', async () => {
    serve();
    await renderApp('/leave?tab=team');
    await screen.findByText('Leave balance');
    expect(screen.queryByText('Who is off')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('settings (HR)', () => {
  function serveSettings(extra: Served = {}) {
    serve(extra);
    const holidays: Holiday[] = [
      {
        id: null,
        date: '2026-01-01',
        key: 'BG.new_year',
        name: null,
        compensates: null,
        country: 'BG',
        halfDay: false,
      },
      {
        id: null,
        date: '2026-05-25',
        key: 'BG.compensation_day',
        name: null,
        compensates: 'BG.culture_day',
        country: 'BG',
        halfDay: false,
      },
      {
        id: uuid(300),
        date: '2026-12-31',
        key: null,
        name: 'Company day',
        compensates: null,
        country: null,
        halfDay: true,
      },
    ];
    const queries: URL[] = [];
    server.use(
      http.get(`${API}/leave/settings`, () =>
        HttpResponse.json({ hideSickTypeFromTeam: false, defaultCountry: 'BG' }),
      ),
      http.get(
        `${API}/leave/holidays`,
        ({ request: r }) => (queries.push(new URL(r.url)), HttpResponse.json(holidays)),
      ),
      http.get(`${API}/org/chart`, () =>
        HttpResponse.json({
          nodes: [
            {
              id: uuid(70),
              firstName: 'Dan',
              lastName: 'Test',
              jobTitle: null,
              managerId: null,
              departmentId: null,
            },
          ],
        }),
      ),
    );
    return queries;
  }

  it('is only for people who manage leave', async () => {
    as('manager');
    serve();
    await renderApp('/leave?tab=settings');
    await screen.findByText('Leave balance');
    expect(screen.queryByText('Leave types')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('lists leave types, marking the built-in ones', async () => {
    as('hr');
    serveSettings();
    await renderApp('/leave?tab=settings');
    const list = await screen.findByRole('list', { name: 'Leave types' });
    expect(within(list).getByText('Annual leave').closest('li')).toHaveTextContent('Built in');
    expect(within(list).getByText('Annual leave').closest('li')).toHaveTextContent(
      'Days per year: 20',
    );
    expect(within(list).getByText('Study leave').closest('li')).not.toHaveTextContent('Built in');
  });

  it('adds a custom type, sending the policy only when it counts against a balance', async () => {
    as('hr');
    serveSettings();
    const bodies: unknown[] = [];
    server.use(
      http.post(
        `${API}/leave/types`,
        async ({ request: r }) => (
          bodies.push(await r.json()),
          HttpResponse.json(TYPES[3], { status: 201 })
        ),
      ),
    );
    await renderApp('/leave?tab=settings');
    const user = userEvent.setup();
    await screen.findByText('Leave types');
    const section = () =>
      screen.getByText('Leave types').closest('div')!.parentElement as HTMLElement;
    await user.click(await screen.findByRole('button', { name: 'Add type' }));
    let form = within(section())
      .getByRole('button', { name: 'Save' })
      .closest('form') as HTMLElement;
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText('This field is required.')).toBeInTheDocument();
    expect(bodies).toEqual([]);
    await user.type(within(form).getByLabelText('Name'), 'Sabbatical');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      name: 'Sabbatical',
      tracksBalance: false,
      requiresApproval: true,
      isSick: false,
      color: 'primary',
    });

    await user.click(await screen.findByRole('button', { name: 'Add type' }));
    form = within(section()).getByRole('button', { name: 'Save' }).closest('form') as HTMLElement;
    await user.type(within(form).getByLabelText('Name'), 'Extra days');
    await user.click(within(form).getByLabelText('Counts against a yearly allowance'));
    await user.clear(within(form).getByLabelText('Days per year'));
    await user.type(within(form).getByLabelText('Days per year'), '1.25');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText('Use whole or half days.')).toBeInTheDocument();
    await user.clear(within(form).getByLabelText('Days per year'));
    await user.type(within(form).getByLabelText('Days per year'), '3.5');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toMatchObject({
      name: 'Extra days',
      tracksBalance: true,
      allowanceDays: 3.5,
      carryOverMaxDays: 0,
    });
  });

  it('edits a built-in type without offering what defines it, and explains refusals', async () => {
    as('hr');
    serveSettings();
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${API}/leave/types/${ANNUAL}`, async ({ request: r }) => {
        bodies.push(await r.json());
        return errorResponse('CONFLICT', 409, { params: { field: 'in_use' } });
      }),
    );
    await renderApp('/leave?tab=settings');
    const user = userEvent.setup();
    const row = (await screen.findByText('Annual leave')).closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Edit' }));
    const edit = (await screen.findAllByRole('button', { name: 'Save' }))[0]!.closest(
      'form',
    ) as HTMLElement;
    expect(within(edit).queryByLabelText('Name')).not.toBeInTheDocument();
    expect(
      within(edit).queryByLabelText('Sick leave (no reason is stored)'),
    ).not.toBeInTheDocument();
    expect(
      within(edit).queryByLabelText('Counts against a yearly allowance'),
    ).not.toBeInTheDocument();
    expect(within(edit).getByLabelText('Days per year')).toHaveValue('20');
    await user.clear(within(edit).getByLabelText('Days per year'));
    await user.type(within(edit).getByLabelText('Days per year'), '25');
    await user.click(within(edit).getByRole('button', { name: 'Save' }));
    expect(await within(edit).findByText(/already has requests/)).toBeInTheDocument();
    expect(bodies[0]).toEqual({
      requiresApproval: true,
      color: 'success',
      allowanceDays: 25,
      carryOverMaxDays: 5,
      isActive: true,
    });
  });

  it('shows holidays with translated built-in names, in the chosen country and year', async () => {
    as('hr');
    const queries = serveSettings();
    await renderApp('/leave?tab=settings');
    const list = await screen.findByRole('list', { name: 'Public holidays' });
    expect(within(list).getByText(/New Year's Day/)).toBeInTheDocument();
    expect(
      within(list).getByText(/Day off for Day of Bulgarian Education and Culture/),
    ).toBeInTheDocument();
    expect(within(list).getByText(/Company day/)).toHaveTextContent('(Half day)');
    expect(queries[0]?.searchParams.get('country')).toBe('BG');
    expect(queries[0]?.searchParams.get('year')).toMatch(/^\d{4}$/);
  });

  it('adds and removes company days; built-in days cannot be removed', async () => {
    as('hr');
    serveSettings();
    const bodies: unknown[] = [];
    let deleted = '';
    server.use(
      http.post(
        `${API}/leave/holidays`,
        async ({ request: r }) => (
          bodies.push(await r.json()),
          HttpResponse.json({}, { status: 201 })
        ),
      ),
      http.delete(
        `${API}/leave/holidays/${uuid(300)}`,
        () => ((deleted = uuid(300)), new HttpResponse(null, { status: 204 })),
      ),
    );
    await renderApp('/leave?tab=settings');
    const user = userEvent.setup();
    const list = await screen.findByRole('list', { name: 'Public holidays' });
    expect(within(list).getAllByRole('button')).toHaveLength(1); // only the company day has a delete button
    await user.click(within(list).getByRole('button', { name: /Delete: Company day/ }));
    await waitFor(() => expect(deleted).toBe(uuid(300)));

    await user.click(screen.getByRole('button', { name: 'Add company day' }));
    expect(await screen.findAllByText('This field is required.')).not.toHaveLength(0);
    await user.type(screen.getByLabelText('Date'), '2030-12-24');
    await user.type(screen.getByLabelText('Name'), 'Office closed');
    await user.click(screen.getByRole('button', { name: 'Add company day' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        { date: '2030-12-24', name: 'Office closed', country: null, halfDay: false },
      ]),
    );
  });

  it('shows a duplicate date clearly', async () => {
    as('hr');
    serveSettings();
    server.use(
      http.post(`${API}/leave/holidays`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'date' } }),
      ),
    );
    await renderApp('/leave?tab=settings');
    const user = userEvent.setup();
    await screen.findByRole('list', { name: 'Public holidays' });
    await user.type(screen.getByLabelText('Date'), '2030-12-24');
    await user.type(screen.getByLabelText('Name'), 'Dup');
    await user.click(screen.getByRole('button', { name: 'Add company day' }));
    expect(await screen.findByText('A holiday already exists on this date.')).toBeInTheDocument();
  });

  it('saves the workspace settings', async () => {
    as('hr');
    serveSettings();
    const bodies: unknown[] = [];
    server.use(
      http.put(`${API}/leave/settings`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json({ hideSickTypeFromTeam: true, defaultCountry: null });
      }),
    );
    await renderApp('/leave?tab=settings');
    const user = userEvent.setup();
    const country = await screen.findByLabelText('Default holiday country');
    expect(country).toHaveValue('BG');
    await user.click(screen.getByLabelText(/Hide the type of sick leave/));
    await user.clear(country);
    await user.click(
      within(country.closest('form') as HTMLElement).getByRole('button', { name: 'Save' }),
    );
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(bodies).toEqual([{ hideSickTypeFromTeam: true, defaultCountry: null }]);
    await user.type(country, 'D1');
    await user.click(
      within(country.closest('form') as HTMLElement).getByRole('button', { name: 'Save' }),
    );
    expect(await screen.findByText('Use a two-letter country code.')).toBeInTheDocument();
  });

  it('adjusts a balance and reports the new figure', async () => {
    as('hr');
    serveSettings();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/leave/balances/adjustments`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(
          {
            leaveTypeId: ANNUAL,
            year: 2026,
            entitled: 20,
            carriedOver: 0,
            adjustment: 2,
            used: 0,
            pending: 0,
            remaining: 22,
          },
          { status: 201 },
        );
      }),
    );
    await renderApp('/leave?tab=settings');
    const user = userEvent.setup();
    const form = (await screen.findByText('Adjust a balance')).closest('div')!.parentElement!;
    await user.click(within(form).getByRole('button', { name: 'Adjust' }));
    expect(await within(form).findAllByText('This field is required.')).not.toHaveLength(0);
    await user.selectOptions(within(form).getByLabelText('Employee'), 'Dan Test');
    await user.type(within(form).getByLabelText(/Days to add/), '2');
    await user.click(within(form).getByRole('button', { name: 'Adjust' }));
    expect(
      await within(form).findByText('The balance is now 22 days remaining.'),
    ).toBeInTheDocument();
    expect(bodies[0]).toMatchObject({ employeeId: uuid(70), leaveTypeId: ANNUAL, delta: 2 });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('notifications about leave', () => {
  const note = (n: number, type: string, params: Record<string, unknown>) => ({
    id: uuid(400 + n),
    type,
    params,
    link: '/leave',
    readAt: null,
    createdAt: '2026-10-21T09:30:00.000Z',
  });

  it('are written in words, in the user language, without any private details', async () => {
    server.use(
      http.get(`${API}/notifications`, () =>
        HttpResponse.json({
          unreadCount: 4,
          nextCursor: null,
          items: [
            note(1, 'leave.requested', {
              requestId: uuid(1),
              employeeName: 'Dan Test',
              startDate: '2026-11-02',
              endDate: '2026-11-06',
              days: 5,
              autoApproved: false,
            }),
            note(2, 'leave.requested', {
              requestId: uuid(2),
              employeeName: 'Eve Test',
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              days: 1,
              autoApproved: true,
            }),
            note(3, 'leave.decided', {
              requestId: uuid(3),
              status: 'rejected',
              startDate: '2026-11-02',
              endDate: '2026-11-06',
            }),
            note(4, 'leave.cancelled', {
              requestId: uuid(4),
              employeeName: 'Gus Test',
              startDate: '2026-11-02',
              endDate: '2026-11-06',
              by: 'employee',
            }),
          ],
        }),
      ),
    );
    await renderApp('/notifications');
    expect(
      await screen.findByText('Dan Test requested 5 days of leave (2 Nov 2026 – 6 Nov 2026).'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Eve Test is absent from 2 Nov 2026 to 2 Nov 2026 (no approval needed).'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Your leave request (2 Nov 2026 – 6 Nov 2026) was rejected.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Gus Test cancelled leave (2 Nov 2026 – 6 Nov 2026).'),
    ).toBeInTheDocument();
  });

  it('also appear in German', async () => {
    await initTestI18n('de');
    server.use(
      http.get(`${API}/notifications`, () =>
        HttpResponse.json({
          unreadCount: 1,
          nextCursor: null,
          items: [
            note(5, 'leave.requested', {
              requestId: uuid(5),
              employeeName: 'Dan Test',
              startDate: '2026-11-02',
              endDate: '2026-11-06',
              days: 4.5,
              autoApproved: false,
            }),
          ],
        }),
      ),
    );
    await renderApp('/notifications');
    expect(await screen.findByText(/Dan Test hat 4,5 Tage Urlaub beantragt/)).toBeInTheDocument();
  });
});

describe('translations', () => {
  const keys = (obj: object, prefix = ''): string[] =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === 'object' && v ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );

  it.each([
    ['en', enLeave],
    ['de', deLeave],
    ['bg', bgLeave],
  ])('has a name for every built-in holiday in %s', (_lang, dict) => {
    const available = new Set(keys(dict));
    for (const key of BUILT_IN_HOLIDAY_KEYS) expect(available, key).toContain(`holiday.${key}`);
  });
});
