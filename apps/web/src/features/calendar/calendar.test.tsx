import type { CalendarEvent, Employee, Holiday, LeaveRequest, Team } from '@intime/contracts';
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
const ME = uuid(50);
const TEAM_A = uuid(70);
const TEAM_B = uuid(71);
const MARCH = '/calendar?view=month&date=2030-03-10';
const AGENDA = '/calendar?view=agenda&date=2030-03-04';

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

const event = (n: number, o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: uuid(100 + n),
  scope: 'personal',
  team: null,
  owner: { id: ME, firstName: 'Maria', lastName: 'Ivanova' },
  title: `Event ${n}`,
  description: null,
  location: null,
  allDay: false,
  startDate: '2030-03-10',
  endDate: '2030-03-10',
  startTime: '09:00',
  endTime: '10:00',
  canEdit: true,
  recurrence: null,
  occurrenceDate: o.startDate ?? '2030-03-10',
  isOrganizer: true,
  attendees: [],
  myResponse: null,
  ...o,
});

const leaveRequest = (n: number, o: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: uuid(200 + n),
  employee: { id: uuid(60 + n), firstName: 'Dan', lastName: 'Dimitrov' },
  leaveType: { id: uuid(1), key: 'annual', name: null, color: 'success', isSick: false },
  masked: false,
  startDate: '2030-03-11',
  endDate: '2030-03-12',
  halfDayStart: false,
  halfDayEnd: false,
  days: 2,
  status: 'approved',
  reason: null,
  decisionComment: null,
  decidedAt: null,
  createdAt: '2030-01-01T08:00:00.000Z',
  canApprove: false,
  canCancel: false,
  ...o,
});

const team = (id: string, name: string, lead: string | null, members: string[]): Team => ({
  id,
  name,
  department: { id: uuid(80), name: 'Eng' },
  lead: lead ? { id: lead, firstName: 'L', lastName: 'Lead' } : null,
  members: members.map((m) => ({ id: m, firstName: 'M', lastName: 'Member' })),
});

interface Served {
  events?: CalendarEvent[];
  leave?: LeaveRequest[];
  holidays?: Holiday[];
  teams?: Team[];
}

function serve(o: Served = {}) {
  const calls = { events: [] as URL[], leave: [] as URL[] };
  server.use(
    http.get(`${API}/employees/me`, () => HttpResponse.json(own())),
    http.get(`${API}/org/teams`, () => HttpResponse.json(o.teams ?? [])),
    http.get(`${API}/calendar/events`, ({ request: r }) => {
      calls.events.push(new URL(r.url));
      return HttpResponse.json({ items: o.events ?? [] });
    }),
    http.get(`${API}/leave/requests`, ({ request: r }) => {
      calls.leave.push(new URL(r.url));
      const items = o.leave ?? [];
      return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 100 });
    }),
    http.get(`${API}/leave/holidays`, () => HttpResponse.json(o.holidays ?? [])),
  );
  return calls;
}
const as = (role: 'employee' | 'manager' | 'hr') =>
  server.use(...signedInHandlers(userWithRole(role)));

// ---------------------------------------------------------------------------------------------------
describe('access and structure', () => {
  it('is not for people without a calendar permission', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    await renderApp('/calendar');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('shows the four views and starts with the month on wide screens', async () => {
    serve();
    await renderApp('/calendar');
    expect(await screen.findByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Month',
      'Week',
      'Day',
      'Agenda',
    ]);
    expect(screen.getByRole('tab', { name: 'Month' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });

  it('is in German and Bulgarian, with localized month names', async () => {
    serve();
    await initTestI18n('de');
    const { unmount } = await renderApp(MARCH);
    expect(await screen.findByRole('heading', { name: 'Kalender' })).toBeInTheDocument();
    expect(await screen.findByText('März 2030')).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp(MARCH);
    expect(await screen.findByRole('heading', { name: 'Календар' })).toBeInTheDocument();
    expect(await screen.findByText(/март 2030/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('month view', () => {
  it('shows six whole weeks, asks for exactly that period and lists the selected day', async () => {
    const calls = serve({
      events: [
        event(1, { title: 'Dentist' }),
        event(2, {
          title: 'Offsite',
          allDay: true,
          startTime: null,
          endTime: null,
          startDate: '2030-03-12',
          endDate: '2030-03-13',
        }),
      ],
    });
    await renderApp(MARCH);
    const grid = await screen.findByRole('grid');
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(42);
    await waitFor(() => expect(calls.events.length).toBeGreaterThan(0));
    const q = calls.events.at(-1)!.searchParams;
    expect([q.get('from'), q.get('to')]).toEqual(['2030-02-25', '2030-04-07']);
    // 10 March is selected: its event is listed below the grid
    expect(await screen.findByText('Dentist')).toBeInTheDocument();
    expect(screen.getByText('My events · 09:00 – 10:00')).toBeInTheDocument();
    // a multi-day event marks every day it covers
    const day = (label: RegExp) => within(grid).getByRole('gridcell', { name: label });
    expect(day(/12 March 2030/)).toHaveAccessibleName(/1 entry/);
    expect(day(/13 March 2030/)).toHaveAccessibleName(/1 entry/);
    expect(day(/14 March 2030/)).not.toHaveAccessibleName(/entr/);
  });

  it('shows another day when tapped', async () => {
    serve({
      events: [
        event(1, { title: 'Dentist' }),
        event(3, { title: 'Review', startDate: '2030-03-20', endDate: '2030-03-20' }),
      ],
    });
    await renderApp(MARCH);
    await screen.findByText('Dentist');
    await userEvent.setup().click(screen.getByRole('gridcell', { name: /20 March 2030/ }));
    expect(await screen.findByText('Review')).toBeInTheDocument();
    expect(screen.queryByText('Dentist')).not.toBeInTheDocument();
  });

  it('moves to the next and previous month and back to today', async () => {
    const calls = serve();
    await renderApp(MARCH);
    const user = userEvent.setup();
    await screen.findByText('March 2030');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('April 2030')).toBeInTheDocument();
    await waitFor(() => expect(calls.events.at(-1)!.searchParams.get('from')).toBe('2030-04-01'));
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('February 2030')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.queryByText('February 2030')).not.toBeInTheDocument();
  });
});

describe('week, day and agenda', () => {
  it('lists the days of the week with empty days marked', async () => {
    const calls = serve({
      events: [event(1, { title: 'Dentist', startDate: '2030-03-05', endDate: '2030-03-05' })],
    });
    await renderApp('/calendar?view=week&date=2030-03-04');
    expect(await screen.findByText('Dentist')).toBeInTheDocument();
    const q = calls.events.at(-1)!.searchParams;
    expect([q.get('from'), q.get('to')]).toEqual(['2030-03-04', '2030-03-10']);
    expect(screen.getAllByText('Nothing on this day.')).toHaveLength(6);
  });

  it('shows one day', async () => {
    const calls = serve({
      events: [event(1, { title: 'Dentist', startDate: '2030-03-04', endDate: '2030-03-04' })],
    });
    await renderApp('/calendar?view=day&date=2030-03-04');
    expect(await screen.findByText('Dentist')).toBeInTheDocument();
    const q = calls.events.at(-1)!.searchParams;
    expect([q.get('from'), q.get('to')]).toEqual(['2030-03-04', '2030-03-04']);
  });

  it('lists only days with something in the agenda, and says so when there is nothing', async () => {
    serve({
      events: [event(1, { title: 'Dentist', startDate: '2030-03-08', endDate: '2030-03-08' })],
    });
    const { unmount } = await renderApp(AGENDA);
    expect(await screen.findByText('Dentist')).toBeInTheDocument();
    expect(screen.queryByText('Nothing on this day.')).not.toBeInTheDocument();
    unmount();
    serve();
    await renderApp(AGENDA);
    expect(await screen.findByText('Nothing in this period.')).toBeInTheDocument();
  });

  it('shows the parts of a multi-day timed event', async () => {
    serve({
      events: [
        event(1, {
          title: 'Night trip',
          startDate: '2030-03-04',
          endDate: '2030-03-05',
          startTime: '22:00',
          endTime: '06:00',
        }),
      ],
    });
    await renderApp(AGENDA);
    expect(await screen.findByText(/From 22:00/)).toBeInTheDocument();
    expect(screen.getByText(/Until 06:00/)).toBeInTheDocument();
  });

  it('switches views from the tabs and keeps the date', async () => {
    const calls = serve();
    await renderApp(MARCH);
    await screen.findByRole('grid');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Week' }));
    await waitFor(() => expect(calls.events.at(-1)!.searchParams.get('from')).toBe('2030-03-04'));
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('layers', () => {
  const holiday: Holiday = {
    id: null,
    date: '2030-03-03',
    key: 'BG.liberation_day',
    name: null,
    compensates: null,
    country: 'BG',
    halfDay: false,
  };

  it('merges leave and holidays with events, read-only', async () => {
    serve({
      events: [event(1, { title: 'Dentist', startDate: '2030-03-04', endDate: '2030-03-04' })],
      leave: [
        leaveRequest(1, { startDate: '2030-03-04', endDate: '2030-03-04' }),
        leaveRequest(2, { startDate: '2030-03-04', endDate: '2030-03-04', status: 'pending' }),
        leaveRequest(3, {
          startDate: '2030-03-04',
          endDate: '2030-03-04',
          leaveType: null,
          masked: true,
        }),
      ],
      holidays: [
        { ...holiday, date: '2030-03-04' },
        { ...holiday, date: '2030-05-05', key: null, name: 'Out of range' },
      ],
    });
    await renderApp(AGENDA);
    expect(await screen.findByText('Dentist')).toBeInTheDocument();
    expect(await screen.findByText('Liberation Day')).toBeInTheDocument();
    expect(screen.getAllByText(/Dan Dimitrov · Annual leave/)).toHaveLength(2);
    expect(screen.getByText('(pending)')).toBeInTheDocument();
    expect(screen.getByText(/Dan Dimitrov · Absent/)).toBeInTheDocument(); // a masked sick leave: only "absent"
    expect(screen.queryByText('Out of range')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1); // only the event
  });

  it('hides a layer when its box is cleared', async () => {
    serve({
      events: [event(1, { title: 'Dentist', startDate: '2030-03-04', endDate: '2030-03-04' })],
      holidays: [{ ...holiday, date: '2030-03-04' }],
    });
    await renderApp(AGENDA);
    await screen.findByText('Liberation Day');
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Public holidays' }));
    expect(screen.queryByText('Liberation Day')).not.toBeInTheDocument();
    expect(screen.getByText('Dentist')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'My events' }));
    expect(screen.queryByText('Dentist')).not.toBeInTheDocument();
  });

  it('does not ask for leave without the permission, and offers no leave layer', async () => {
    server.use(...signedInHandlers(userWithPermissions({ 'calendar.manage_own': 'own' })));
    const calls = serve({ leave: [leaveRequest(1)] });
    await renderApp(AGENDA);
    await screen.findByRole('checkbox', { name: 'My events' });
    expect(screen.queryByRole('checkbox', { name: 'Leave' })).not.toBeInTheDocument();
    expect(calls.leave).toEqual([]);
  });

  it('does not ask for leave when the layer is switched off', async () => {
    const calls = serve({ leave: [leaveRequest(1)] });
    await renderApp(AGENDA);
    await screen.findByRole('checkbox', { name: 'Leave' });
    await waitFor(() => expect(calls.leave.length).toBeGreaterThan(0));
    const before = calls.leave.length;
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Leave' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('checkbox', { name: 'Leave' });
    expect(calls.leave.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('creating events', () => {
  const open = async () => {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New event' }));
    return { user, form: within(await screen.findByRole('form', { name: 'New event' })) };
  };

  it('checks the form before sending anything', async () => {
    serve();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/calendar/events`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(event(1), { status: 201 });
      }),
    );
    await renderApp(AGENDA);
    const { user, form } = await open();
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await screen.findAllByText('This field is required.')).toHaveLength(3); // title and both times
    await user.type(form.getByLabelText('Title'), 'Dentist');
    await user.type(form.getByLabelText('Start time'), '10:00');
    await user.type(form.getByLabelText('End time'), '09:00');
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The end cannot be before the start.')).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('sends a timed event for the selected day and closes the form', async () => {
    serve();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/calendar/events`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(event(1), { status: 201 });
      }),
    );
    await renderApp(AGENDA);
    const { user, form } = await open();
    expect(form.getByLabelText('Start date')).toHaveValue('2030-03-04');
    await user.type(form.getByLabelText('Title'), '  Dentist ');
    await user.type(form.getByLabelText('Start time'), '09:00');
    await user.type(form.getByLabelText('End time'), '10:30');
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        {
          scope: 'personal',
          title: 'Dentist',
          allDay: false,
          startDate: '2030-03-04',
          endDate: '2030-03-04',
          startTime: '09:00',
          endTime: '10:30',
        },
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'New event' })).not.toBeInTheDocument(),
    );
  });

  it('hides the times for an all-day event and sends none', async () => {
    serve();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post(`${API}/calendar/events`, async ({ request: r }) => {
        bodies.push((await r.json()) as Record<string, unknown>);
        return HttpResponse.json(event(1), { status: 201 });
      }),
    );
    await renderApp(AGENDA);
    const { user, form } = await open();
    await user.type(form.getByLabelText('Title'), 'Conference');
    await user.click(form.getByLabelText('All day'));
    expect(form.queryByLabelText('Start time')).not.toBeInTheDocument();
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ allDay: true });
    expect(bodies[0]).not.toHaveProperty('startTime');
  });

  it('offers only "only me" to employees, more to managers and HR', async () => {
    const scopes = async () => {
      const { form } = await open();
      return within(form.getByLabelText('Calendar'))
        .getAllByRole('option')
        .map((o) => o.textContent);
    };
    serve();
    const first = await renderApp(AGENDA);
    expect(await scopes()).toEqual(['Only me']);
    first.unmount();
    as('manager');
    serve();
    const second = await renderApp(AGENDA);
    expect(await scopes()).toEqual(['Only me', 'A team']);
    second.unmount();
    as('hr');
    serve();
    await renderApp(AGENDA);
    expect(await scopes()).toEqual(['Only me', 'A team', 'Everybody']);
  });

  it('lets a manager pick only their own teams, and HR all of them', async () => {
    const teams = [team(TEAM_A, 'Alpha', ME, []), team(TEAM_B, 'Beta', uuid(99), [uuid(98)])];
    const options = async () => {
      const { user, form } = await open();
      await user.selectOptions(form.getByLabelText('Calendar'), 'A team');
      return within(form.getByLabelText('Team'))
        .getAllByRole('option')
        .map((o) => o.textContent);
    };
    as('manager');
    serve({ teams });
    const first = await renderApp(AGENDA);
    expect(await options()).toEqual(['—', 'Alpha']);
    first.unmount();
    as('hr');
    serve({ teams });
    await renderApp(AGENDA);
    expect(await options()).toEqual(['—', 'Alpha', 'Beta']);
  });

  it('requires a team for a team event and sends it', async () => {
    as('hr');
    serve({ teams: [team(TEAM_A, 'Alpha', null, [])] });
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/calendar/events`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(event(1, { scope: 'team' }), { status: 201 });
      }),
    );
    await renderApp(AGENDA);
    const { user, form } = await open();
    await user.selectOptions(form.getByLabelText('Calendar'), 'A team');
    await user.type(form.getByLabelText('Title'), 'Planning');
    await user.click(form.getByLabelText('All day'));
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This field is required.')).toBeInTheDocument();
    await user.selectOptions(form.getByLabelText('Team'), 'Alpha');
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ scope: 'team', teamId: TEAM_A });
  });

  it.each([
    ['FORBIDDEN', 403, {}, 'You are not allowed to do this.'],
    [
      'VALIDATION_FAILED',
      400,
      { details: [{ path: 'startTime', code: 'nonexistent_time', message: 'x' }] },
      'That time does not exist on that day (clocks change).',
    ],
  ] as const)('shows the server answer %s', async (code, status, extra, text) => {
    serve();
    server.use(http.post(`${API}/calendar/events`, () => errorResponse(code, status, extra)));
    await renderApp(AGENDA);
    const { user, form } = await open();
    await user.type(form.getByLabelText('Title'), 'Dentist');
    await user.type(form.getByLabelText('Start time'), '03:30');
    await user.type(form.getByLabelText('End time'), '05:00');
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('closes the form with cancel without sending anything', async () => {
    serve();
    const bodies: unknown[] = [];
    server.use(
      http.post(
        `${API}/calendar/events`,
        async ({ request: r }) => (bodies.push(await r.json()), HttpResponse.json(event(1))),
      ),
    );
    await renderApp(AGENDA);
    const { user, form } = await open();
    await user.click(form.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New event' })).not.toBeInTheDocument();
    expect(bodies).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('changing and deleting events', () => {
  const day = { startDate: '2030-03-04', endDate: '2030-03-04' };

  it('edits an event and sends the changed fields; scope and team are not offered', async () => {
    serve({ events: [event(1, { title: 'Dentist', ...day, location: 'Clinic' })] });
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${API}/calendar/events/${uuid(101)}`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(event(1));
      }),
    );
    await renderApp(AGENDA);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const form = within(screen.getByRole('form', { name: 'Change event' }));
    expect(form.queryByLabelText('Calendar')).not.toBeInTheDocument();
    const title = form.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Dentist (moved)');
    await user.clear(form.getByLabelText('Location (optional)'));
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        {
          title: 'Dentist (moved)',
          description: null,
          location: null,
          allDay: false,
          ...day,
          startTime: '09:00',
          endTime: '10:00',
        },
      ]),
    );
  });

  it('offers no actions on events the server says cannot be changed', async () => {
    serve({ events: [event(1, { title: 'Party', scope: 'company', canEdit: false, ...day })] });
    await renderApp(AGENDA);
    expect(await screen.findByText('Party')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('asks before deleting, and does nothing when kept', async () => {
    serve({ events: [event(1, { title: 'Dentist', ...day })] });
    const deleted: string[] = [];
    server.use(
      http.delete(`${API}/calendar/events/${uuid(101)}`, ({ request: r }) => {
        deleted.push(new URL(r.url).pathname);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderApp(AGENDA);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this event?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(deleted).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(deleted).toHaveLength(1));
  });

  it('shows the error when deleting fails', async () => {
    serve({ events: [event(1, { title: 'Dentist', ...day })] });
    server.use(
      http.delete(`${API}/calendar/events/${uuid(101)}`, () => errorResponse('FORBIDDEN', 403)),
    );
    await renderApp(AGENDA);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByText('You are not allowed to do this.')).toBeInTheDocument();
  });
});

describe('repeating events, guests and answers', () => {
  const DAN = uuid(61);
  const day = { startDate: '2030-03-04', endDate: '2030-03-04' };
  const weekly: NonNullable<CalendarEvent['recurrence']> = {
    freq: 'weekly',
    interval: 1,
    weekdays: [],
    until: null,
    count: null,
  };
  const dan = { id: DAN, firstName: 'Dan', lastName: 'Dimitrov' };
  const serveWithPeople = (o: Served = {}) => {
    serve(o);
    server.use(
      http.get(`${API}/org/chart`, () =>
        HttpResponse.json({
          nodes: [
            {
              id: ME,
              firstName: 'Maria',
              lastName: 'Ivanova',
              jobTitle: null,
              managerId: null,
              departmentId: null,
            },
            {
              id: DAN,
              firstName: 'Dan',
              lastName: 'Dimitrov',
              jobTitle: null,
              managerId: null,
              departmentId: null,
            },
            {
              id: uuid(62),
              firstName: 'Eve',
              lastName: 'Evans',
              jobTitle: null,
              managerId: null,
              departmentId: null,
            },
          ],
        }),
      ),
    );
  };
  const openNew = async () => {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New event' }));
    return { user, form: within(await screen.findByRole('form', { name: 'New event' })) };
  };

  it('creates a repeating event with a guest', async () => {
    serveWithPeople();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/calendar/events`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(event(1), { status: 201 });
      }),
    );
    await renderApp(AGENDA);
    const { user, form } = await openNew();
    await user.type(form.getByLabelText('Title'), 'Sync');
    await user.type(form.getByLabelText('Start time'), '09:00');
    await user.type(form.getByLabelText('End time'), '09:30');
    await user.selectOptions(form.getByLabelText('Repeats'), 'weekly');
    await user.clear(form.getByLabelText('Interval in weeks'));
    await user.type(form.getByLabelText('Interval in weeks'), '2');
    await user.click(form.getByRole('checkbox', { name: /Wed/ }));
    await user.selectOptions(form.getByLabelText('Ends'), 'count');
    await user.type(form.getByLabelText('Number of times'), '4');
    await user.type(form.getByLabelText('Invite colleagues (type a name)'), 'dan');
    await user.click(await form.findByRole('button', { name: 'Invite Dan Dimitrov' }));
    expect(form.getByRole('button', { name: 'Remove Dan Dimitrov' })).toBeInTheDocument();
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        {
          scope: 'personal',
          title: 'Sync',
          allDay: false,
          startDate: '2030-03-04',
          endDate: '2030-03-04',
          startTime: '09:00',
          endTime: '09:30',
          recurrence: { freq: 'weekly', interval: 2, weekdays: [2], until: null, count: 4 },
          attendeeIds: [DAN],
        },
      ]),
    );
  });

  it('removes a guest again and checks the repeat fields before sending', async () => {
    serveWithPeople();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/calendar/events`, async ({ request: r }) => {
        bodies.push(await r.json());
        return HttpResponse.json(event(1), { status: 201 });
      }),
    );
    await renderApp(AGENDA);
    const { user, form } = await openNew();
    await user.type(form.getByLabelText('Title'), 'Sync');
    await user.type(form.getByLabelText('Start time'), '09:00');
    await user.type(form.getByLabelText('End time'), '09:30');
    await user.type(form.getByLabelText('Invite colleagues (type a name)'), 'dan');
    await user.click(await form.findByRole('button', { name: 'Invite Dan Dimitrov' }));
    await user.click(form.getByRole('button', { name: 'Remove Dan Dimitrov' }));
    expect(form.getByText('No guests yet.')).toBeInTheDocument();
    await user.type(form.getByLabelText('Invite colleagues (type a name)'), 'zzz');
    expect(await form.findByText('Nobody found.')).toBeInTheDocument();
    await user.selectOptions(form.getByLabelText('Repeats'), 'daily');
    await user.clear(form.getByLabelText('Interval in days'));
    await user.type(form.getByLabelText('Interval in days'), '0');
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await form.findByText('Enter a whole number from 1 to 30.')).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('offers guests only on personal events', async () => {
    serveWithPeople({ teams: [team(TEAM_A, 'Alpha', ME, [ME])] });
    as('manager');
    await renderApp(AGENDA);
    const { user, form } = await openNew();
    expect(form.getByLabelText('Invite colleagues (type a name)')).toBeInTheDocument();
    await user.selectOptions(form.getByLabelText('Calendar'), 'team');
    expect(form.queryByLabelText('Invite colleagues (type a name)')).not.toBeInTheDocument();
    expect(form.queryByRole('button', { name: 'Find a time' })).not.toBeInTheDocument();
  });

  it('shows every occurrence of a series, the repeat, the guests and their answers', async () => {
    const series = {
      recurrence: { ...weekly, interval: 2 },
      attendees: [
        { employee: dan, response: 'accepted' as const },
        {
          employee: { id: uuid(62), firstName: 'Eve', lastName: 'Evans' },
          response: 'needs_action' as const,
        },
      ],
    };
    serveWithPeople({
      events: [
        event(1, { title: 'Sync', ...day, occurrenceDate: '2030-03-04', ...series }),
        event(1, {
          title: 'Sync',
          startDate: '2030-03-18',
          endDate: '2030-03-18',
          occurrenceDate: '2030-03-18',
          ...series,
        }),
      ],
    });
    await renderApp('/calendar?view=agenda&date=2030-03-04');
    expect(await screen.findAllByText('Sync')).toHaveLength(2);
    expect(screen.getAllByText('Repeats every 2 weeks')).toHaveLength(2);
    expect(screen.getAllByText('Dan Dimitrov · Accepted')).toHaveLength(2);
    expect(screen.getAllByText('Eve Evans · No answer yet')).toHaveLength(2);
  });

  it('lets a guest answer, and offers no editing', async () => {
    serveWithPeople({
      events: [
        event(1, {
          title: 'Lunch',
          ...day,
          scope: 'personal',
          canEdit: false,
          isOrganizer: false,
          owner: dan,
          myResponse: 'needs_action',
          attendees: [
            {
              employee: { id: ME, firstName: 'Maria', lastName: 'Ivanova' },
              response: 'needs_action',
            },
          ],
        }),
      ],
    });
    const answers: unknown[] = [];
    server.use(
      http.put(`${API}/calendar/events/${uuid(101)}/response`, async ({ request: r }) => {
        answers.push(await r.json());
        return HttpResponse.json(event(1));
      }),
    );
    await renderApp(AGENDA);
    expect(await screen.findByText('Organizer: Dan Dimitrov')).toBeInTheDocument();
    expect(screen.getByText('Your answer: No answer yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(answers).toEqual([{ response: 'declined' }]));
  });

  it('marks the current answer and shows the error when answering fails', async () => {
    serveWithPeople({
      events: [
        event(1, {
          title: 'Lunch',
          ...day,
          canEdit: false,
          isOrganizer: false,
          owner: dan,
          myResponse: 'accepted',
        }),
      ],
    });
    server.use(
      http.put(`${API}/calendar/events/${uuid(101)}/response`, () =>
        errorResponse('NOT_FOUND', 404),
      ),
    );
    await renderApp(AGENDA);
    const accept = await screen.findByRole('button', { name: 'Accept' });
    expect(accept).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Maybe' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Maybe' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('does not show answer buttons to the organizer', async () => {
    serveWithPeople({ events: [event(1, { title: 'Mine', ...day })] });
    await renderApp(AGENDA);
    await screen.findByText('Mine');
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  describe('editing and deleting a series', () => {
    const occurrence = event(1, {
      title: 'Sync',
      ...day,
      occurrenceDate: '2030-03-04',
      recurrence: weekly,
    });
    const capture = () => {
      const calls: { url: URL; body?: unknown }[] = [];
      server.use(
        http.patch(`${API}/calendar/events/${uuid(101)}`, async ({ request: r }) => {
          calls.push({ url: new URL(r.url), body: await r.json() });
          return HttpResponse.json(event(1));
        }),
        http.delete(`${API}/calendar/events/${uuid(101)}`, ({ request: r }) => {
          calls.push({ url: new URL(r.url) });
          return new HttpResponse(null, { status: 204 });
        }),
      );
      return calls;
    };

    it('changes only this occurrence, without sending the rule', async () => {
      serveWithPeople({ events: [occurrence] });
      const calls = capture();
      await renderApp(AGENDA);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Edit' }));
      const form = within(screen.getByRole('form', { name: 'Change event' }));
      expect(form.getByRole('radio', { name: 'All events' })).toBeChecked();
      await user.click(form.getByRole('radio', { name: 'This event only' }));
      expect(form.queryByLabelText('Repeats')).not.toBeInTheDocument();
      await user.clear(form.getByLabelText('Title'));
      await user.type(form.getByLabelText('Title'), 'Sync (moved)');
      await user.click(form.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.url.search).toBe('?mode=this&occurrence=2030-03-04');
      expect(calls[0]!.body).toMatchObject({ title: 'Sync (moved)' });
      expect(calls[0]!.body).not.toHaveProperty('recurrence');
    });

    it('sends no scope for the whole series and keeps an unchanged rule out of the request', async () => {
      serveWithPeople({ events: [occurrence] });
      const calls = capture();
      await renderApp(AGENDA);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Edit' }));
      const form = within(screen.getByRole('form', { name: 'Change event' }));
      expect(form.getByLabelText('Repeats')).toHaveValue('weekly');
      await user.click(form.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.url.search).toBe('');
      expect(calls[0]!.body).not.toHaveProperty('recurrence');
      expect(calls[0]!.body).not.toHaveProperty('attendeeIds');
    });

    it('stops a series from repeating by sending null', async () => {
      serveWithPeople({ events: [occurrence] });
      const calls = capture();
      await renderApp(AGENDA);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Edit' }));
      const form = within(screen.getByRole('form', { name: 'Change event' }));
      await user.selectOptions(form.getByLabelText('Repeats'), 'none');
      await user.click(form.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.body).toMatchObject({ recurrence: null });
    });

    it('asks which events to delete and sends the chosen scope', async () => {
      serveWithPeople({ events: [occurrence] });
      const calls = capture();
      await renderApp(AGENDA);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      await user.click(screen.getByRole('radio', { name: 'This and the following events' }));
      await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.url.search).toBe('?mode=following&occurrence=2030-03-04');
    });

    it('does not ask for a scope when the event does not repeat', async () => {
      serveWithPeople({ events: [event(1, { title: 'Once', ...day })] });
      const calls = capture();
      await renderApp(AGENDA);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.url.search).toBe('');
    });

    it('does not let a guest change the guest list of an event they do not organize', async () => {
      serveWithPeople({
        events: [
          event(1, { title: 'Theirs', ...day, canEdit: true, isOrganizer: false, owner: dan }),
        ],
      });
      await renderApp(AGENDA);
      await userEvent.setup().click(await screen.findByRole('button', { name: 'Edit' }));
      const form = within(screen.getByRole('form', { name: 'Change event' }));
      expect(form.queryByLabelText('Invite colleagues (type a name)')).not.toBeInTheDocument();
    });
  });

  describe('finding a time', () => {
    it('suggests times for you and the guests and fills the form from the chosen one', async () => {
      serveWithPeople();
      const asked: unknown[] = [];
      server.use(
        http.post(`${API}/calendar/find-time`, async ({ request: r }) => {
          asked.push(await r.json());
          return HttpResponse.json({
            slots: [
              { date: '2030-03-05', startTime: '10:00', endTime: '11:00' },
              { date: '2030-03-06', startTime: '14:30', endTime: '15:30' },
            ],
          });
        }),
      );
      await renderApp(AGENDA);
      const { user, form } = await openNew();
      await user.type(form.getByLabelText('Invite colleagues (type a name)'), 'dan');
      await user.click(await form.findByRole('button', { name: 'Invite Dan Dimitrov' }));
      await user.click(form.getByRole('button', { name: 'Find a time' }));
      await user.selectOptions(form.getByLabelText('Length'), '90');
      await user.click(form.getByRole('button', { name: 'Search' }));
      await waitFor(() =>
        expect(asked).toEqual([
          { employeeIds: [ME, DAN], from: '2030-03-04', to: '2030-03-10', durationMinutes: 90 },
        ]),
      );
      const list = await form.findByRole('list', { name: 'Suggested times' });
      expect(within(list).getAllByRole('button')).toHaveLength(2);
      await user.click(within(list).getByRole('button', { name: /14:30–15:30/ }));
      expect(form.getByLabelText('Start date')).toHaveValue('2030-03-06');
      expect(form.getByLabelText('End date')).toHaveValue('2030-03-06');
      expect(form.getByLabelText('Start time')).toHaveValue('14:30');
      expect(form.getByLabelText('End time')).toHaveValue('15:30');
    });

    it('says when nobody is free, and shows an error when the search fails', async () => {
      serveWithPeople();
      server.use(http.post(`${API}/calendar/find-time`, () => HttpResponse.json({ slots: [] })));
      await renderApp(AGENDA);
      const { user, form } = await openNew();
      await user.click(form.getByRole('button', { name: 'Find a time' }));
      await user.click(form.getByRole('button', { name: 'Search' }));
      expect(await form.findByText(/Nobody is free in this period/)).toBeInTheDocument();
      server.use(http.post(`${API}/calendar/find-time`, () => errorResponse('FORBIDDEN', 403)));
      await user.click(form.getByRole('button', { name: 'Search' }));
      expect(await form.findByText('You are not allowed to do this.')).toBeInTheDocument();
    });
  });

  it('is available in German and Bulgarian', async () => {
    serveWithPeople({
      events: [
        event(1, {
          title: 'Sync',
          ...day,
          recurrence: { ...weekly, interval: 2 },
          canEdit: false,
          isOrganizer: false,
          owner: dan,
          myResponse: 'needs_action',
        }),
      ],
    });
    await initTestI18n('de');
    const { unmount } = await renderApp(AGENDA);
    expect(await screen.findByText('Wiederholt sich alle 2 Wochen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zusagen' })).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp(AGENDA);
    expect(await screen.findByText('Повтаря се на всеки 2 седмици')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Приемам' })).toBeInTheDocument();
  });
});

describe('loading problems', () => {
  it('shows the API error when events cannot be loaded', async () => {
    serve();
    server.use(http.get(`${API}/calendar/events`, () => errorResponse('INTERNAL_ERROR', 500)));
    await renderApp(AGENDA);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
