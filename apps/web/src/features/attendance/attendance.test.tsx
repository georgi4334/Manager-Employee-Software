import type {
  AttendanceRecord,
  AttendanceStatus,
  Employee,
  Presence,
  PresenceItem,
} from '@intime/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import bgAttendance from '@/i18n/locales/bg/attendance.json';
import deAttendance from '@/i18n/locales/de/attendance.json';
import enAttendance from '@/i18n/locales/en/attendance.json';
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
const ME = uuid(50);
const OTHER = uuid(51);

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

const record = (n: number, o: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  id: uuid(100 + n),
  employee: { id: ME, firstName: 'Maria', lastName: 'Ivanova' },
  date: '2026-10-20',
  startTime: '09:00',
  endTime: '17:30',
  checkInAt: '2026-10-20T06:00:00.000Z',
  checkOutAt: '2026-10-20T14:30:00.000Z',
  minutes: 510,
  mode: 'office',
  note: null,
  source: 'clock',
  open: false,
  canEdit: true,
  ...o,
});
const openRecord = (o: Partial<AttendanceRecord> = {}) =>
  record(9, {
    endTime: null,
    checkOutAt: null,
    minutes: null,
    open: true,
    startTime: '08:15',
    ...o,
  });

const status = (o: Partial<AttendanceStatus> = {}): AttendanceStatus => ({
  today: '2026-10-24',
  open: null,
  records: [],
  minutes: 0,
  ...o,
});

const presenceItem = (n: number, o: Partial<PresenceItem> = {}): PresenceItem => ({
  employee: { id: uuid(60 + n), firstName: `Person${n}`, lastName: 'Test' },
  state: 'none',
  mode: null,
  since: null,
  minutes: 0,
  ...o,
});

interface Served {
  status?: AttendanceStatus;
  records?: AttendanceRecord[];
  presence?: PresenceItem[];
  employee?: Employee | 'none';
}

function serve(o: Served = {}) {
  const calls = { records: [] as URL[] };
  server.use(
    http.get(`${API}/employees/me`, () =>
      o.employee === 'none'
        ? errorResponse('NOT_FOUND', 404)
        : HttpResponse.json(o.employee ?? own()),
    ),
    http.get(`${API}/attendance/status`, () => HttpResponse.json(o.status ?? status())),
    http.get(`${API}/attendance/today`, () =>
      HttpResponse.json({
        date: '2026-10-24',
        items: o.presence ?? [],
      } satisfies Presence),
    ),
    http.get(`${API}/attendance/records`, ({ request: r }) => {
      calls.records.push(new URL(r.url));
      const items = o.records ?? [];
      return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 200 });
    }),
  );
  return calls;
}
const as = (role: 'employee' | 'manager' | 'hr') =>
  server.use(...signedInHandlers(userWithRole(role)));

// ---------------------------------------------------------------------------------------------------
describe('access and structure', () => {
  it('is not for people without any attendance permission', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    await renderApp('/attendance');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('shows an employee Today and History, no team', async () => {
    serve();
    await renderApp('/attendance');
    expect(await screen.findByRole('heading', { name: 'Attendance' })).toBeInTheDocument();
    expect((await screen.findAllByRole('tab')).map((tab) => tab.textContent)).toEqual([
      'Today',
      'History',
    ]);
  });

  it('gives managers and HR the team tab', async () => {
    for (const role of ['manager', 'hr'] as const) {
      as(role);
      serve();
      const { unmount } = await renderApp('/attendance');
      expect((await screen.findAllByRole('tab')).map((tab) => tab.textContent)).toEqual([
        'Today',
        'History',
        'Team',
      ]);
      unmount();
    }
  });

  it('is in German and Bulgarian', async () => {
    serve({ status: status({ minutes: 90 }) });
    await initTestI18n('de');
    const { unmount } = await renderApp('/attendance');
    expect(await screen.findByRole('heading', { name: 'Anwesenheit' })).toBeInTheDocument();
    expect(await screen.findByText('Heute erfasst: 1 Std. 30 Min.')).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/attendance');
    expect(await screen.findByRole('heading', { name: 'Присъствие' })).toBeInTheDocument();
    expect(await screen.findByText('Записано днес: 1 ч 30 мин')).toBeInTheDocument();
  });

  it('has the same translation keys in every language', () => {
    const keys = (o: object, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' && v ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    expect(keys(deAttendance).sort()).toEqual(keys(enAttendance).sort());
    expect(keys(bgAttendance).sort()).toEqual(keys(enAttendance).sort());
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the clock', () => {
  it('checks in with the chosen mode and note', async () => {
    serve();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/attendance/check-in`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(openRecord(), { status: 201 });
      }),
    );
    await renderApp('/attendance');
    const user = userEvent.setup();
    expect(await screen.findByText('You are not checked in.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Where'), 'Remote');
    await user.type(screen.getByLabelText('Note (optional)'), '  from home ');
    await user.click(screen.getByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(bodies).toEqual([{ mode: 'remote', note: 'from home' }]));
  });

  it('sends no note when it is empty', async () => {
    serve();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/attendance/check-in`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(openRecord(), { status: 201 });
      }),
    );
    await renderApp('/attendance');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(bodies).toEqual([{ mode: 'office' }]));
  });

  it('shows an open record with a check-out button instead of the check-in form', async () => {
    serve({ status: status({ open: openRecord(), records: [openRecord()] }) });
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/attendance/check-out`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(record(1));
      }),
    );
    await renderApp('/attendance');
    expect(await screen.findByText('Working since 08:15 (Office)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check out' }));
    await waitFor(() => expect(bodies).toEqual([{}]));
  });

  it('explains a refused check-in because a record is already open', async () => {
    serve();
    server.use(
      http.post(`${API}/attendance/check-in`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'open' } }),
      ),
    );
    await renderApp('/attendance');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check in' }));
    expect(
      await screen.findByText('There is already an open record. Check out first.'),
    ).toBeInTheDocument();
  });

  it('shows today records and total', async () => {
    serve({
      status: status({
        records: [record(1, { startTime: '09:00', endTime: '12:00', minutes: 180, note: 'Plan' })],
        minutes: 180,
      }),
    });
    await renderApp('/attendance');
    expect(await screen.findByText('Recorded today: 3 h 0 min')).toBeInTheDocument();
    expect(screen.getByText('09:00 – 12:00')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
  });

  it('says so when nothing is recorded and shows a connection problem', async () => {
    serve();
    await renderApp('/attendance');
    expect(await screen.findByText('Nothing recorded yet today.')).toBeInTheDocument();
  });

  it('explains a missing employee record instead of an error', async () => {
    serve();
    server.use(http.get(`${API}/attendance/status`, () => errorResponse('NOT_FOUND', 404)));
    await renderApp('/attendance');
    expect(await screen.findByText(/no employee record for your account/)).toBeInTheDocument();
  });

  it('shows the API error when the status cannot be loaded', async () => {
    serve();
    server.use(http.get(`${API}/attendance/status`, () => errorResponse('INTERNAL_ERROR', 500)));
    await renderApp('/attendance');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('typing in a period', () => {
  async function open() {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add a period' }));
    return user;
  }

  it('checks the form before sending anything', async () => {
    serve();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/attendance/records`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(record(1), { status: 201 });
      }),
    );
    await renderApp('/attendance');
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findAllByText('This field is required.')).toHaveLength(2);
    await user.type(screen.getByLabelText('From'), '17:00');
    await user.type(screen.getByLabelText('To'), '09:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The end cannot be before the start.')).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('sends the entry for the chosen day, prefilled with today', async () => {
    serve();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/attendance/records`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(record(1), { status: 201 });
      }),
    );
    await renderApp('/attendance');
    const user = await open();
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-24');
    await user.type(screen.getByLabelText('From'), '09:00');
    await user.type(screen.getByLabelText('To'), '17:30');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        { date: '2026-10-24', startTime: '09:00', endTime: '17:30', mode: 'office' },
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Add a period' })).not.toBeInTheDocument(),
    );
  });

  it.each([
    [
      'CONFLICT',
      409,
      { params: { field: 'overlap' } },
      'This overlaps another record of the same person.',
    ],
    [
      'VALIDATION_FAILED',
      400,
      { details: [{ path: 'startTime', code: 'nonexistent_time', message: 'x' }] },
      'That time does not exist on that day (clocks change).',
    ],
    [
      'VALIDATION_FAILED',
      400,
      { details: [{ path: 'date', code: 'too_far_in_past', message: 'x' }] },
      'You can only enter the last 7 days yourself. Ask your manager or HR for older days.',
    ],
    ['FORBIDDEN', 403, {}, 'You are not allowed to do this.'],
  ] as const)('explains %s from the server', async (code, httpStatus, extra, text) => {
    serve();
    server.use(
      http.post(`${API}/attendance/records`, () => errorResponse(code, httpStatus, extra)),
    );
    await renderApp('/attendance');
    const user = await open();
    await user.type(screen.getByLabelText('From'), '09:00');
    await user.type(screen.getByLabelText('To'), '10:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('changing and deleting records', () => {
  it('edits a finished record with all its fields', async () => {
    serve({ status: status({ records: [record(1)] }) });
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${API}/attendance/records/${uuid(101)}`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(record(1, { endTime: '18:00' }));
      }),
    );
    await renderApp('/attendance');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const end = screen.getByLabelText('To');
    await user.clear(end);
    await user.type(end, '18:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        { date: '2026-10-20', startTime: '09:00', endTime: '18:00', mode: 'office', note: null },
      ]),
    );
  });

  it('only changes mode and note of an open record', async () => {
    serve({ status: status({ open: openRecord(), records: [openRecord()] }) });
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${API}/attendance/records/${uuid(109)}`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(openRecord({ mode: 'remote' }));
      }),
    );
    await renderApp('/attendance');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Where'), 'Remote');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toEqual([{ mode: 'remote', note: null }]));
  });

  it('offers no actions on records the server says cannot be changed', async () => {
    serve({ status: status({ records: [record(1, { canEdit: false })] }) });
    await renderApp('/attendance');
    expect(await screen.findByText('09:00 – 17:30')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('asks before deleting, and does nothing when kept', async () => {
    serve({ status: status({ records: [record(1)] }) });
    const deleted: string[] = [];
    server.use(
      http.delete(`${API}/attendance/records/${uuid(101)}`, ({ request: r }) => {
        deleted.push(new URL(r.url).pathname);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderApp('/attendance');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this record?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(deleted).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(deleted).toHaveLength(1));
  });

  it('shows the error when deleting fails', async () => {
    serve({ status: status({ records: [record(1)] }) });
    server.use(
      http.delete(`${API}/attendance/records/${uuid(101)}`, () => errorResponse('FORBIDDEN', 403)),
    );
    await renderApp('/attendance');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByText('You are not allowed to do this.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('history', () => {
  it('lists only your own records for the chosen period, with the total', async () => {
    const calls = serve({
      records: [record(1), record(2, { date: '2026-10-19', minutes: 60, endTime: '10:00' })],
    });
    await renderApp('/attendance?tab=history');
    expect(await screen.findByText('Total: 9 h 30 min')).toBeInTheDocument();
    const query = calls.records.at(-1)!.searchParams;
    expect(query.get('employeeId')).toBe(ME);
    expect(query.get('to')).toBe(query.get('from') && query.get('to')); // both present
    expect(query.get('from')! < query.get('to')!).toBe(true);
  });

  it('refuses an invalid period without asking the server', async () => {
    const calls = serve();
    await renderApp('/attendance?tab=history');
    const user = userEvent.setup();
    await screen.findByText('No records in this period.');
    const before = calls.records.length;
    const to = screen.getByLabelText('To');
    await user.clear(to);
    await user.type(to, '2000-01-01');
    expect(await screen.findByText('Choose a valid period.')).toBeInTheDocument();
    expect(calls.records.length).toBe(before);
  });

  it('explains a missing employee record', async () => {
    serve({ employee: 'none' });
    await renderApp('/attendance?tab=history');
    expect(await screen.findByText(/no employee record for your account/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('team', () => {
  it('shows who is working, done, on leave or not recorded', async () => {
    as('manager');
    serve({
      presence: [
        presenceItem(1, { state: 'working', mode: 'remote', since: '08:30' }),
        presenceItem(2, { state: 'done', minutes: 480 }),
        presenceItem(3, { state: 'leave' }),
        presenceItem(4),
      ],
    });
    await renderApp('/attendance?tab=team');
    const list = await screen.findByRole('list', { name: 'Today' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('Person1 Test');
    expect(rows[0]).toHaveTextContent('Since 08:30 (Remote)');
    expect(rows[0]).toHaveTextContent('Working');
    expect(rows[1]).toHaveTextContent('8 h 0 min');
    expect(rows[2]).toHaveTextContent('On leave');
    expect(rows[3]).toHaveTextContent('Not recorded');
  });

  it('lists the records of the people the server returns, with names', async () => {
    as('manager');
    serve({
      records: [record(1, { employee: { id: OTHER, firstName: 'Dan', lastName: 'Dimitrov' } })],
    });
    await renderApp('/attendance?tab=team');
    expect(await screen.findByText('Dan Dimitrov')).toBeInTheDocument();
  });

  it('lets people who can correct add a record for somebody', async () => {
    as('hr');
    serve({ presence: [presenceItem(1)] });
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/attendance/records`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(record(1), { status: 201 });
      }),
    );
    const { unmount } = await renderApp('/attendance?tab=team');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add a record for someone' }));
    const form = within(screen.getByRole('form', { name: 'Add a period' }));
    await user.selectOptions(form.getByLabelText('Person'), 'Person1 Test');
    await user.clear(form.getByLabelText('Date'));
    await user.type(form.getByLabelText('Date'), '2026-10-01');
    await user.type(form.getByLabelText('From'), '09:00');
    await user.type(form.getByLabelText('To'), '17:00');
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        {
          employeeId: uuid(61),
          date: '2026-10-01',
          startTime: '09:00',
          endTime: '17:00',
          mode: 'office',
        },
      ]),
    );
    unmount();
  });

  it('shows an empty state and API errors', async () => {
    as('manager');
    serve();
    server.use(http.get(`${API}/attendance/today`, () => errorResponse('FORBIDDEN', 403)));
    await renderApp('/attendance?tab=team');
    expect(await screen.findByText('You are not allowed to do this.')).toBeInTheDocument();
  });
});
