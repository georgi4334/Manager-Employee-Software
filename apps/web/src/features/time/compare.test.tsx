import type { Compare } from '@intime/contracts';
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
const WEEK = '2026-10-26';

const day = (i: number, o: Partial<Compare['days'][number]> = {}): Compare['days'][number] => ({
  date: `2026-10-${26 + i}`,
  attendanceMinutes: 0,
  loggedMinutes: 0,
  onLeave: false,
  openRecord: false,
  flag: 'none',
  ...o,
});
const compare = (days: Compare['days'][number][]): Compare => ({
  weekStart: WEEK,
  days: [0, 1, 2, 3, 4, 5, 6].map(
    (i) => days.find((d) => d.date === `2026-10-${26 + i}`) ?? day(i),
  ),
});

function serve(data?: Compare | 'error') {
  const calls = { compare: [] as URL[] };
  server.use(
    http.get(`${API}/time/week`, () =>
      HttpResponse.json({
        weekStart: WEEK,
        employee: { id: uuid(60), firstName: 'Eva', lastName: 'E' },
        status: null,
        timesheetId: null,
        entries: [],
        days: [],
        totalMinutes: 0,
        billableMinutes: 0,
        canSubmit: false,
      }),
    ),
    http.get(`${API}/time/timer`, () => HttpResponse.json({ timer: null })),
    http.get(`${API}/time/timesheets`, () =>
      HttpResponse.json({
        items: [
          {
            id: uuid(700),
            employee: { id: uuid(80), firstName: 'Person', lastName: 'Test' },
            weekStart: WEEK,
            status: 'submitted',
            totalMinutes: 480,
            submittedAt: '2026-11-02T09:00:00Z',
            decidedAt: null,
            canDecide: true,
            canReopen: false,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      }),
    ),
    http.get(`${API}/time/timesheets/:id`, () =>
      HttpResponse.json({
        weekStart: WEEK,
        employee: { id: uuid(80), firstName: 'Person', lastName: 'Test' },
        status: 'submitted',
        timesheetId: uuid(700),
        entries: [],
        days: [],
        totalMinutes: 0,
        billableMinutes: 0,
        canSubmit: false,
      }),
    ),
    http.get(`${API}/projects`, () =>
      HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 25 }),
    ),
    http.get(`${API}/time/compare`, ({ request }) => {
      calls.compare.push(new URL(request.url));
      return data === 'error'
        ? errorResponse('NOT_FOUND', 404)
        : HttpResponse.json(data ?? compare([]));
    }),
  );
  return calls;
}

describe('my week', () => {
  it('is fetched only when asked for, and shows presence next to logged time with the flags in words', async () => {
    const calls = serve(
      compare([
        day(0, { attendanceMinutes: 480, loggedMinutes: 480 }),
        day(1, { attendanceMinutes: 240, loggedMinutes: 480, flag: 'more_logged' }),
        day(2, { attendanceMinutes: 480, loggedMinutes: 60, flag: 'less_logged' }),
        day(3, { loggedMinutes: 480, onLeave: true }),
        day(4, { attendanceMinutes: 0, loggedMinutes: 30, openRecord: true }),
      ]),
    );
    await renderApp('/time');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Compare with attendance' });
    expect(calls.compare).toHaveLength(0);
    await user.click(button);
    const panel = await screen.findByRole('region', { name: 'Presence and logged time' });
    const rows = within(panel).getAllByRole('listitem');
    expect(rows).toHaveLength(5); // weekend days with nothing are left out
    expect(rows[0]).toHaveTextContent('present 8:00 h · logged 8:00 h');
    expect(rows[0]).not.toHaveTextContent('more');
    expect(rows[1]).toHaveTextContent('more time logged than presence');
    expect(rows[2]).toHaveTextContent('more presence than time logged');
    expect(rows[3]).toHaveTextContent('leave');
    expect(rows[3]).not.toHaveTextContent('than');
    expect(rows[4]).toHaveTextContent('check-out missing');
    expect(calls.compare).toHaveLength(1);
    const asked = calls.compare[0]!.searchParams.get('weekStart')!;
    expect(new Date(`${asked}T00:00:00Z`).getUTCDay()).toBe(1); // the Monday of the week shown
    expect(calls.compare[0]!.searchParams.has('employeeId')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Hide the comparison' }));
    expect(
      screen.queryByRole('region', { name: 'Presence and logged time' }),
    ).not.toBeInTheDocument();
  });

  it('says so when there is nothing on either side', async () => {
    serve(compare([]));
    await renderApp('/time');
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Compare with attendance' }));
    expect(
      await screen.findByText('Nothing recorded on either side this week.'),
    ).toBeInTheDocument();
  });

  it('shows nothing at all when the server does not offer it', async () => {
    serve('error');
    await renderApp('/time');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Compare with attendance' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Presence and logged time' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('is not offered without permission to see attendance', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'time.log': 'own', 'timesheet.submit': 'own' })),
    );
    serve();
    await renderApp('/time');
    await screen.findByText(/Week of/);
    expect(
      screen.queryByRole('button', { name: 'Compare with attendance' }),
    ).not.toBeInTheDocument();
  });

  it('is in German and Bulgarian', async () => {
    serve();
    await initTestI18n('de');
    const { unmount } = await renderApp('/time');
    expect(
      await screen.findByRole('button', { name: 'Mit Anwesenheit vergleichen' }),
    ).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/time');
    expect(
      await screen.findByRole('button', { name: 'Сравни с присъствието' }),
    ).toBeInTheDocument();
  });
});

describe('approvals', () => {
  it("shows the person's comparison right away next to their time, for that person", async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    const calls = serve(
      compare([day(0, { attendanceMinutes: 480, loggedMinutes: 100, flag: 'less_logged' })]),
    );
    await renderApp('/time?tab=approvals');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Show the time of Person Test' }));
    const panel = await screen.findByRole('region', { name: 'Presence and logged time' });
    expect(within(panel).getByText(/more presence than time logged/)).toBeInTheDocument();
    expect(calls.compare[0]!.searchParams.get('employeeId')).toBe(uuid(80));
    expect(calls.compare[0]!.searchParams.get('weekStart')).toBe(WEEK);
    expect(
      screen.queryByRole('button', { name: 'Compare with attendance' }),
    ).not.toBeInTheDocument();
  });
});
