import type { ProjectSummary, TimeEntry, Timesheet, TimeWeek } from '@intime/contracts';
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
const ME = { id: uuid(60), firstName: 'Eva', lastName: 'Employee' };
const WEEK = '2026-10-26';
const days = (minutes: number[] = [0, 0, 0, 0, 0, 0, 0]) =>
  minutes.map((m, i) => ({ date: `2026-10-${26 + i}`, minutes: m }));

const entry = (n: number, o: Partial<TimeEntry> = {}): TimeEntry => ({
  id: uuid(500 + n),
  employee: ME,
  project: { id: P1, code: 'WEB', name: 'Website' },
  task: null,
  workDate: WEEK,
  minutes: 90,
  isBillable: true,
  note: null,
  source: 'manual',
  startedAt: null,
  running: false,
  canEdit: true,
  ...o,
});

const week = (o: Partial<TimeWeek> = {}): TimeWeek => ({
  weekStart: WEEK,
  employee: ME,
  status: null,
  timesheetId: null,
  entries: [],
  days: days(),
  totalMinutes: 0,
  billableMinutes: 0,
  canSubmit: true,
  ...o,
});

const project = (o: Partial<ProjectSummary> = {}): ProjectSummary => ({
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
  lead: null,
  health: 'on_track',
  canEdit: false,
  canStaff: false,
  ...o,
});

const sheet = (n: number, o: Partial<Timesheet> = {}): Timesheet => ({
  id: uuid(700 + n),
  employee: { id: uuid(80 + n), firstName: `Person${n}`, lastName: 'Test' },
  weekStart: WEEK,
  status: 'submitted',
  totalMinutes: 480,
  submittedAt: '2026-11-02T09:00:00Z',
  decidedAt: null,
  canDecide: true,
  canReopen: false,
  ...o,
});

interface Served {
  week?: TimeWeek;
  timer?: TimeEntry | null;
  sheets?: Timesheet[];
  projects?: ProjectSummary[];
}

function serve(o: Served = {}) {
  const calls = {
    weeks: [] as string[],
    posts: [] as { url: string; body: unknown }[],
    patches: [] as unknown[],
    deletes: [] as string[],
    sheets: [] as string[],
  };
  server.use(
    http.get(`${API}/time/week`, ({ request }) => {
      calls.weeks.push(new URL(request.url).searchParams.get('weekStart') ?? '');
      return HttpResponse.json(o.week ?? week());
    }),
    http.get(`${API}/time/timer`, () => HttpResponse.json({ timer: o.timer ?? null })),
    http.get(`${API}/time/timesheets`, ({ request }) => {
      calls.sheets.push(new URL(request.url).searchParams.get('status') ?? '');
      const items = o.sheets ?? [];
      return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 50 });
    }),
    http.get(`${API}/time/timesheets/:id`, () =>
      HttpResponse.json(week({ entries: [entry(1, { canEdit: false })], days: days([90]) })),
    ),
    http.get(`${API}/projects`, () => {
      const items = o.projects ?? [project()];
      return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 25 });
    }),
    http.get(`${API}/tasks`, () =>
      HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 200 }),
    ),
    http.post(`${API}/time/timer/start`, async ({ request }) => {
      calls.posts.push({ url: 'start', body: await request.json() });
      return HttpResponse.json(entry(2, { running: true, minutes: null, source: 'timer' }), {
        status: 201,
      });
    }),
    http.post(`${API}/time/timer/stop`, () => {
      calls.posts.push({ url: 'stop', body: null });
      return HttpResponse.json(entry(2));
    }),
    http.post(`${API}/time/entries`, async ({ request }) => {
      calls.posts.push({ url: 'entries', body: await request.json() });
      return HttpResponse.json(entry(3), { status: 201 });
    }),
    http.patch(`${API}/time/entries/:id`, async ({ request }) => {
      calls.patches.push(await request.json());
      return HttpResponse.json(entry(1));
    }),
    http.delete(`${API}/time/entries/:id`, ({ params }) => {
      calls.deletes.push(String(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${API}/time/timesheets/submit`, async ({ request }) => {
      calls.posts.push({ url: 'submit', body: await request.json() });
      return HttpResponse.json(sheet(1, { status: 'submitted', canDecide: false }));
    }),
    http.post(`${API}/time/timesheets/:id/:action`, ({ params }) => {
      calls.posts.push({ url: String(params.action), body: params.id });
      return HttpResponse.json(sheet(1, { status: 'approved' }));
    }),
  );
  return calls;
}
const as = (role: 'employee' | 'manager' | 'hr') =>
  server.use(...signedInHandlers(userWithRole(role)));

/** Pages open on "this week": pin it by asking for the same week the fixtures use. */
const open = (path = '/time') => renderApp(path);

describe('access and structure', () => {
  it('is not for people without a time permission', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    await open();
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('needs a time permission and nothing else', async () => {
    server.use(...signedInHandlers(userWithPermissions({ 'time.log': 'own' })));
    serve();
    await open();
    expect(await screen.findByRole('heading', { name: 'Time' })).toBeInTheDocument();
  });

  it('gives employees their week only, managers also approvals and reports', async () => {
    serve();
    const { unmount } = await open();
    expect(await screen.findByRole('heading', { name: 'Time' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    unmount();
    as('manager');
    serve();
    await open();
    expect((await screen.findAllByRole('tab')).map((tab) => tab.textContent)).toEqual([
      'My time',
      'Approvals',
      'Reports',
    ]);
  });

  it('is in German and Bulgarian', async () => {
    serve();
    await initTestI18n('de');
    const { unmount } = await open();
    expect(await screen.findByRole('heading', { name: 'Zeit' })).toBeInTheDocument();
    expect(await screen.findByText('Nicht eingereicht')).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await open();
    expect(await screen.findByRole('heading', { name: 'Време' })).toBeInTheDocument();
    expect(await screen.findByText('Не е изпратена')).toBeInTheDocument();
  });
});

describe('my week', () => {
  it('shows days with entries, totals and the state in words', async () => {
    serve({
      week: week({
        status: 'rejected',
        entries: [
          entry(1, { note: 'Reviewed', task: { id: uuid(9), key: 'WEB-3' } }),
          entry(2, { minutes: 30, isBillable: false }),
        ],
        days: days([120, 0, 0, 0, 0, 0, 0]),
        totalMinutes: 120,
        billableMinutes: 90,
      }),
    });
    await open();
    const rows = within(await screen.findByRole('list', { name: 'Days of the week' }));
    expect(rows.getAllByRole('listitem')[0]).toHaveTextContent('Monday');
    expect(await screen.findByText('2:00 h logged · 1:30 h billable')).toBeInTheDocument();
    expect(screen.getAllByText('Sent back').length).toBeGreaterThan(0);
    expect(screen.getByText(/WEB-3/)).toBeInTheDocument();
    expect(screen.getByText('Reviewed')).toBeInTheDocument();
    expect(screen.getByText('Not billable')).toBeInTheDocument();
    expect(screen.getByText(/was sent back/)).toBeInTheDocument();
  });

  it('asks for the week that is shown and moves between weeks', async () => {
    const calls = serve();
    await open();
    const heading = async () =>
      (await screen.findByRole('heading', { name: /Week of/ })).textContent;
    const first = await heading();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    await waitFor(async () => expect(await heading()).not.toBe(first));
    expect(calls.weeks.at(-1)! < calls.weeks[0]!).toBe(true); // an earlier Monday was requested
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(async () => expect(await heading()).toBe(first));
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    await user.click(await screen.findByRole('button', { name: 'This week' }));
    await waitFor(async () => expect(await heading()).toBe(first));
    expect(screen.queryByRole('button', { name: 'This week' })).not.toBeInTheDocument();
  });

  it('hides editing and submitting while a week is submitted or approved', async () => {
    serve({
      week: week({
        status: 'submitted',
        entries: [entry(1, { canEdit: false })],
        canSubmit: false,
      }),
    });
    await open();
    expect(await screen.findByText(/This week is submitted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add time' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit week' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('adds time with a project, a duration typed as 1:30, and refuses a bad duration', async () => {
    const calls = serve();
    await open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add time' }));
    const form = screen.getByRole('form', { name: 'Add time' });
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findAllByText('This field is required.')).toHaveLength(2);
    await user.selectOptions(await within(form).findByLabelText('Project'), P1);
    await user.type(within(form).getByLabelText('Duration'), 'abc');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText(/Enter a duration like 1:30/)).toBeInTheDocument();
    const duration = within(form).getByLabelText('Duration');
    await user.clear(duration);
    await user.type(duration, '1:30');
    await user.type(within(form).getByLabelText('Note (optional)'), 'Reviewed');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.posts.filter((p) => p.url === 'entries')).toHaveLength(1));
    expect(calls.posts.find((p) => p.url === 'entries')!.body).toMatchObject({
      projectId: P1,
      minutes: 90,
      note: 'Reviewed',
      isBillable: true,
    });
  });

  it('explains a refused entry', async () => {
    serve();
    server.use(
      http.post(`${API}/time/entries`, () =>
        errorResponse('VALIDATION_FAILED', 400, {
          details: [{ path: 'minutes', code: 'day_too_long', message: 'x' }],
        }),
      ),
    );
    await open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add time' }));
    const form = screen.getByRole('form', { name: 'Add time' });
    await user.selectOptions(await within(form).findByLabelText('Project'), P1);
    await user.type(within(form).getByLabelText('Duration'), '5');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(
      await within(form).findByText('A day cannot hold more than 24 hours.'),
    ).toBeInTheDocument();
  });

  it('edits only what changed and deletes', async () => {
    const calls = serve({
      week: week({ entries: [entry(1)], days: days([90]), totalMinutes: 90 }),
    });
    await open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit time' });
    const duration = within(form).getByLabelText('Duration');
    expect(duration).toHaveValue('1:30');
    await user.clear(duration);
    await user.type(duration, '2:00');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.patches).toEqual([{ minutes: 120 }]));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.deletes).toEqual([uuid(501)]));
  });

  it('submits the week and shows a refusal', async () => {
    const calls = serve({ week: week({ entries: [entry(1)], totalMinutes: 90 }) });
    await open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Submit week' }));
    await waitFor(() => expect(calls.posts.find((p) => p.url === 'submit')).toBeDefined());
    expect(calls.posts.find((p) => p.url === 'submit')!.body).toEqual({
      weekStart: calls.weeks[0],
    });

    server.use(
      http.post(`${API}/time/timesheets/submit`, () =>
        errorResponse('VALIDATION_FAILED', 400, {
          details: [{ path: 'weekStart', code: 'timer_running', message: 'x' }],
        }),
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Submit week' }));
    expect(
      await screen.findByText('Stop the running timer before submitting this week.'),
    ).toBeInTheDocument();
  });

  it('does not offer submitting when the server says it cannot be', async () => {
    serve({ week: week({ canSubmit: false }) });
    await open();
    await screen.findByText(/Week of/);
    expect(screen.queryByRole('button', { name: 'Submit week' })).not.toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    server.use(http.get(`${API}/time/week`, () => errorResponse('INTERNAL', 500)));
    serve();
    server.use(http.get(`${API}/time/week`, () => errorResponse('INTERNAL', 500)));
    await open();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('the timer', () => {
  it('starts on a project with a note', async () => {
    const calls = serve();
    await open();
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Start the timer' });
    await user.click(within(form).getByRole('button', { name: 'Start' }));
    expect(await within(form).findByText('This field is required.')).toBeInTheDocument();
    await user.selectOptions(await within(form).findByLabelText('Project'), P1);
    await user.type(within(form).getByLabelText('Note (optional)'), 'Focus');
    await user.click(within(form).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(calls.posts.filter((p) => p.url === 'start')).toHaveLength(1));
    expect(calls.posts.find((p) => p.url === 'start')!.body).toEqual({
      projectId: P1,
      note: 'Focus',
    });
  });

  it('shows the running timer and stops it', async () => {
    const calls = serve({
      timer: entry(2, {
        running: true,
        minutes: null,
        source: 'timer',
        startedAt: new Date(Date.now() - 65_000).toISOString(),
        note: 'Focus',
      }),
    });
    await open();
    expect(await screen.findByText(/Running on WEB · Website/)).toBeInTheDocument();
    expect(screen.getByText('Focus')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Start the timer' })).not.toBeInTheDocument();
    expect(screen.getByText(/^0:01:0\d$/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(calls.posts.some((p) => p.url === 'stop')).toBe(true));
  });

  it('explains a second timer', async () => {
    serve();
    server.use(
      http.post(`${API}/time/timer/start`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'running' } }),
      ),
    );
    await open();
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Start the timer' });
    await user.selectOptions(await within(form).findByLabelText('Project'), P1);
    await user.click(within(form).getByRole('button', { name: 'Start' }));
    expect(
      await within(form).findByText('A timer is already running. Stop it first.'),
    ).toBeInTheDocument();
  });

  it('offers no finished projects when starting', async () => {
    serve({
      projects: [project(), project({ id: uuid(2), code: 'OLD', name: 'Old', status: 'done' })],
    });
    await open();
    const form = await screen.findByRole('form', { name: 'Start the timer' });
    await within(form).findByRole('option', { name: 'WEB · Website' });
    expect(within(form).queryByRole('option', { name: 'OLD · Old' })).not.toBeInTheDocument();
  });
});

describe('approvals', () => {
  const approvals = async () => {
    as('manager');
    const calls = serve({
      sheets: [sheet(1), sheet(2, { canDecide: false, status: 'approved', canReopen: true })],
    });
    await open('/time?tab=approvals');
    return calls;
  };

  it('lists sheets waiting first, with who, which week and how long', async () => {
    const calls = await approvals();
    const list = await screen.findByRole('list', { name: 'Approvals' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Person1 Test');
    expect(rows[0]).toHaveTextContent('8:00 h');
    expect(calls.sheets[0]).toBe('submitted');
  });

  it('approves and sends back only where the server allows it', async () => {
    const calls = await approvals();
    const user = userEvent.setup();
    expect(
      await screen.findByRole('button', { name: 'Approve the week of Person1 Test' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve the week of Person2 Test' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reopen the week of Person2 Test' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reopen the week of Person1 Test' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve the week of Person1 Test' }));
    await waitFor(() => expect(calls.posts).toContainEqual({ url: 'approve', body: uuid(701) }));
    await user.click(screen.getByRole('button', { name: 'Send back the week of Person1 Test' }));
    await waitFor(() => expect(calls.posts).toContainEqual({ url: 'reject', body: uuid(701) }));
    await user.click(screen.getByRole('button', { name: 'Reopen the week of Person2 Test' }));
    await waitFor(() => expect(calls.posts).toContainEqual({ url: 'reopen', body: uuid(702) }));
  });

  it('shows the time behind a sheet, read only', async () => {
    await approvals();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Show the time of Person1 Test' }));
    const days = await screen.findByRole('list', { name: 'Days of the week' });
    expect(within(days).getByText(/WEB · Website/)).toBeInTheDocument();
    expect(within(days).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide the time of Person1 Test' }));
    expect(screen.queryByRole('list', { name: 'Days of the week' })).not.toBeInTheDocument();
  });

  it('filters by status and shows an empty state', async () => {
    as('manager');
    const calls = serve({ sheets: [] });
    await open('/time?tab=approvals');
    expect(await screen.findByText('No timesheets to show.')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Status'), 'all');
    await waitFor(() => expect(calls.sheets.at(-1)).toBe('all'));
  });

  it('explains a sheet that was already decided', async () => {
    await approvals();
    server.use(
      http.post(`${API}/time/timesheets/:id/:action`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'status' } }),
      ),
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Approve the week of Person1 Test' }),
    );
    expect(await screen.findByText('This timesheet was already decided.')).toBeInTheDocument();
  });

  it('is not offered to people who cannot approve', async () => {
    serve();
    await open('/time?tab=approvals');
    await screen.findByText(/Week of/); // falls back to their own week
    expect(screen.queryByRole('tab', { name: 'Approvals' })).not.toBeInTheDocument();
  });
});
