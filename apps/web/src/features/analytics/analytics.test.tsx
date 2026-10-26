import type { Analytics } from '@intime/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
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

const analytics = (o: Partial<Analytics> = {}): Analytics => ({
  from: '2026-10-01',
  to: '2026-10-30',
  population: 12,
  people: {
    headcount: 12,
    hires: 2,
    leavers: 1,
    byDepartment: [
      { id: uuid(1), name: 'Engineering', count: 8 },
      { id: null, name: null, count: 4 },
    ],
    byEmploymentType: [{ type: 'full_time', count: 12 }],
  },
  absence: {
    days: 14.5,
    pendingRequests: 3,
    daysPerPerson: 1.2,
    byType: [{ key: 'annual', name: null, days: 14.5 }],
  },
  attendance: {
    records: 40,
    workedMinutes: 19200,
    byMode: [{ mode: 'remote', records: 40 }],
  },
  time: {
    loggedMinutes: 9000,
    billablePercent: 75,
    approvedPercent: null,
    weeks: [
      { weekStart: '2026-09-28', minutes: 3000 },
      { weekStart: '2026-10-05', minutes: 6000 },
    ],
    topProjects: [{ id: uuid(5), code: 'WEB-1', name: 'Website', minutes: 9000 }],
  },
  projects: {
    byStatus: [
      { status: 'planned', count: 1 },
      { status: 'active', count: 4 },
      { status: 'paused', count: 0 },
      { status: 'done', count: 2 },
    ],
    openTasks: 31,
    overdueTasks: 5,
    budgetWarning: 2,
    budgetOver: 1,
  },
  company: {
    goals: {
      byStatus: [
        { status: 'draft', count: 1 },
        { status: 'active', count: 7 },
        { status: 'done', count: 3 },
        { status: 'cancelled', count: 0 },
      ],
      overdue: 2,
    },
    reviews: {
      cycleId: uuid(7),
      name: 'Annual 2026',
      status: 'open',
      total: 12,
      selfSubmitted: 9,
      managerSubmitted: 4,
      released: 0,
    },
  },
  ...o,
});

function serve(data: Analytics = analytics()) {
  const calls: URL[] = [];
  server.use(
    http.get(`${API}/analytics`, ({ request }) => {
      calls.push(new URL(request.url));
      return HttpResponse.json(data);
    }),
  );
  return calls;
}

describe('access', () => {
  it('is for people with the analytics permission only', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    await renderApp('/analytics');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('needs the team analytics permission and nothing else', async () => {
    server.use(...signedInHandlers(userWithPermissions({ 'analytics.view_team': 'team' })));
    serve();
    await renderApp('/analytics');
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument();
    expect(await screen.findByText('Active people')).toBeInTheDocument();
  });

  it('is in German and Bulgarian', async () => {
    server.use(...signedInHandlers(userWithRole('hr')));
    serve();
    await initTestI18n('de');
    const { unmount } = await renderApp('/analytics');
    expect(await screen.findByRole('heading', { name: 'Analysen' })).toBeInTheDocument();
    expect(await screen.findByText('Aktive Personen')).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/analytics');
    expect(await screen.findByRole('heading', { name: 'Анализи' })).toBeInTheDocument();
    expect(await screen.findByText('Активни хора')).toBeInTheDocument();
  });
});

describe('the dashboard', () => {
  beforeEach(() => {
    server.use(...signedInHandlers(userWithRole('hr')));
  });

  it('asks for the last 30 days ending today by default', async () => {
    const calls = serve();
    await renderApp('/analytics');
    await screen.findByText('Active people');
    const q = calls.at(-1)!.searchParams;
    const days =
      (Date.parse(`${q.get('to')}T00:00:00Z`) - Date.parse(`${q.get('from')}T00:00:00Z`)) /
      86_400_000;
    expect(days).toBe(29);
  });

  it('shows the numbers in words and with the value next to every bar', async () => {
    serve();
    await renderApp('/analytics');
    const people = (await screen.findByRole('heading', { name: 'People' })).closest('section')!;
    expect(within(people).getByText('Active people').nextSibling).toHaveTextContent('12');
    expect(within(people).getByText('Engineering')).toBeInTheDocument();
    expect(within(people).getByText('No department')).toBeInTheDocument();
    expect(within(people).getByText('Full-time')).toBeInTheDocument();

    const absence = screen.getByRole('heading', { name: 'Absence' }).closest('section')!;
    expect(within(absence).getByText('Annual leave')).toBeInTheDocument();
    expect(within(absence).getAllByText('14.5 days').length).toBeGreaterThan(0);

    const time = screen.getByRole('heading', { name: 'Time on projects' }).closest('section')!;
    expect(within(time).getByText('Billable share').nextSibling).toHaveTextContent('75%');
    // nothing approved yet: a dash, not 0 %
    expect(within(time).getByText('Approved share').nextSibling).toHaveTextContent('–');
    expect(within(time).getByText('WEB-1 · Website')).toBeInTheDocument();
    expect(within(time).getByText('50:00 h')).toBeInTheDocument();

    const projects = screen
      .getByRole('heading', { name: 'Projects and tasks' })
      .closest('section')!;
    expect(within(projects).getByText('Overdue tasks').nextSibling).toHaveTextContent('5');
  });

  it('shows the company sections when they are in the response', async () => {
    serve();
    await renderApp('/analytics');
    const company = (await screen.findByRole('heading', { name: 'Company' })).closest('section')!;
    expect(within(company).getByText('Overdue goals').nextSibling).toHaveTextContent('2');
    expect(within(company).getByText('Reviews: Annual 2026')).toBeInTheDocument();
    expect(within(company).getByText('Released to employees')).toBeInTheDocument();
  });

  it('leaves the company sections out when the server sent none', async () => {
    serve(analytics({ company: null }));
    await renderApp('/analytics');
    await screen.findByText('Active people');
    expect(screen.queryByRole('heading', { name: 'Company' })).not.toBeInTheDocument();
  });

  it('says so when no review cycle exists', async () => {
    const base = analytics();
    serve(analytics({ company: { goals: base.company!.goals, reviews: null } }));
    await renderApp('/analytics');
    expect(await screen.findByText('Reviews: no cycle has been opened yet')).toBeInTheDocument();
  });

  it('explains withheld breakdowns in words and keeps the totals', async () => {
    serve(
      analytics({
        population: 3,
        people: {
          headcount: 3,
          hires: 0,
          leavers: 0,
          byDepartment: null,
          byEmploymentType: null,
        },
        absence: { days: 2, pendingRequests: 0, daysPerPerson: 0.7, byType: null },
        attendance: { records: 4, workedMinutes: 1920, byMode: null },
        company: null,
      }),
    );
    await renderApp('/analytics');
    expect(await screen.findByText(/The figures are about 3 active people\./)).toBeInTheDocument();
    expect(screen.getByText(/Breakdowns are hidden for fewer than 5 people/)).toBeInTheDocument();
    expect(screen.getAllByText(/Not shown: the group is too small/)).toHaveLength(4);
    expect(screen.getByText('Active people').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('Approved leave days').nextSibling).toHaveTextContent('2');
  });

  it('shows "nothing in this period" instead of an empty chart', async () => {
    serve(
      analytics({
        absence: { days: 0, pendingRequests: 0, daysPerPerson: 0, byType: [] },
        attendance: { records: 0, workedMinutes: 0, byMode: [] },
        time: {
          loggedMinutes: 0,
          billablePercent: null,
          approvedPercent: null,
          weeks: [],
          topProjects: [],
        },
      }),
    );
    await renderApp('/analytics');
    await screen.findByText('Active people');
    expect(screen.getAllByText('Nothing in this period.').length).toBe(3);
  });

  it('asks again with another period', async () => {
    const calls = serve();
    await renderApp('/analytics');
    await screen.findByText('Active people');
    await userEvent.selectOptions(screen.getByLabelText('Period'), '90');
    await screen.findByText('Active people');
    await waitFor(() => {
      const q = calls.at(-1)!.searchParams;
      const days =
        (Date.parse(`${q.get('to')}T00:00:00Z`) - Date.parse(`${q.get('from')}T00:00:00Z`)) /
        86_400_000;
      expect(days).toBe(89);
    });
  });

  it('shows an error and lets the user try again', async () => {
    server.use(http.get(`${API}/analytics`, () => errorResponse('INTERNAL', 500)));
    await renderApp('/analytics');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    serve();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Active people')).toBeInTheDocument();
  });
});
