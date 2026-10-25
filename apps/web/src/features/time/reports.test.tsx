import type { ExportData, Report, ReportRow } from '@intime/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

const row = (n: number, o: Partial<ReportRow> = {}): ReportRow => ({
  id: uuid(n),
  label: `Project ${n}`,
  detail: `P-${n}`,
  totalMinutes: 270,
  billableMinutes: 210,
  approvedMinutes: 180,
  budgetMinutes: null,
  loggedMinutes: null,
  ...o,
});

const report = (rows: ReportRow[], o: Partial<Report> = {}): Report => ({
  from: '2026-10-01',
  to: '2026-10-31',
  groupBy: 'project',
  rows,
  totalMinutes: rows.reduce((s, r) => s + r.totalMinutes, 0),
  billableMinutes: rows.reduce((s, r) => s + r.billableMinutes, 0),
  approvedMinutes: rows.reduce((s, r) => s + r.approvedMinutes, 0),
  ...o,
});

function serve(rows: ReportRow[] = [row(1)], exported?: ExportData) {
  const calls = { reports: [] as URL[], exports: [] as URL[] };
  server.use(
    http.get(`${API}/time/week`, () =>
      HttpResponse.json({
        weekStart: '2026-10-26',
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
      HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 50 }),
    ),
    http.get(`${API}/projects`, () =>
      HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 25 }),
    ),
    http.get(`${API}/time/reports`, ({ request }) => {
      calls.reports.push(new URL(request.url));
      return HttpResponse.json(report(rows));
    }),
    http.get(`${API}/time/reports/export`, ({ request }) => {
      calls.exports.push(new URL(request.url));
      return HttpResponse.json(
        exported ?? {
          from: '2026-10-01',
          to: '2026-10-31',
          rows: [
            {
              workDate: '2026-10-26',
              person: 'Eva Employee',
              projectCode: 'WEB-1',
              projectName: 'Website',
              task: null,
              minutes: 90,
              isBillable: true,
            },
          ],
        },
      );
    }),
  );
  return calls;
}
const as = (role: 'employee' | 'manager' | 'hr') =>
  server.use(...signedInHandlers(userWithRole(role)));
const open = () => renderApp('/time?tab=reports');

afterEach(() => vi.restoreAllMocks());

describe('access', () => {
  it('has no reports tab for employees', async () => {
    serve();
    await renderApp('/time?tab=reports');
    await screen.findByText(/Week of/); // falls back to their own week
    expect(screen.queryByRole('tab', { name: 'Reports' })).not.toBeInTheDocument();
  });

  it('gives managers a reports tab with all three groupings', async () => {
    as('manager');
    serve();
    await open();
    expect(await screen.findByRole('tab', { name: 'Reports', selected: true })).toBeInTheDocument();
    const options = within(screen.getByLabelText('Group by')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Project', 'Person', 'Client']);
  });

  it('offers no client grouping without permission to see clients', async () => {
    server.use(
      ...signedInHandlers(
        userWithPermissions({
          'time.report_project': 'all',
          'time.view': 'all',
          'time.log': 'own',
        }),
      ),
    );
    serve();
    await open();
    const options = within(await screen.findByLabelText('Group by')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Project', 'Person']);
  });

  it('starts with person reports for people who may only view time', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'time.view': 'team', 'time.log': 'own' })),
    );
    const calls = serve();
    await open();
    await screen.findByLabelText('Group by');
    expect(
      within(screen.getByLabelText('Group by'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Person']);
    await waitFor(() => expect(calls.reports.at(-1)?.searchParams.get('groupBy')).toBe('person'));
  });

  it('is in German and Bulgarian', async () => {
    as('manager');
    serve();
    await initTestI18n('de');
    const { unmount } = await open();
    expect(await screen.findByRole('tab', { name: 'Berichte' })).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await open();
    expect(await screen.findByRole('tab', { name: 'Отчети' })).toBeInTheDocument();
  });
});

describe('the report', () => {
  it('asks for this month grouped by project, and shows totals and rows', async () => {
    as('manager');
    const calls = serve([row(1), row(2, { label: 'Beta', detail: 'P-2', totalMinutes: 30 })]);
    await open();
    const list = await screen.findByRole('list', { name: 'Reports' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Project 1');
    expect(items[0]).toHaveTextContent('P-1');
    expect(items[0]).toHaveTextContent('4:30 h');
    expect(items[0]).toHaveTextContent('Billable 3:30 h · approved 3:00 h');
    expect(
      screen.getByText('Total 5:00 h · billable 7:00 h · approved 6:00 h'),
    ).toBeInTheDocument();
    const q = calls.reports.at(-1)!.searchParams;
    expect(q.get('groupBy')).toBe('project');
    expect(q.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
    expect(q.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(q.has('projectId')).toBe(false);
  });

  it('says in words how much of the budget is used', async () => {
    as('hr');
    serve([
      row(1, { label: 'Fine', budgetMinutes: 6000, loggedMinutes: 1200 }),
      row(2, { label: 'Close', budgetMinutes: 600, loggedMinutes: 540 }),
      row(3, { label: 'Over', budgetMinutes: 600, loggedMinutes: 900 }),
      row(4, { label: 'Free', budgetMinutes: null, loggedMinutes: 100 }),
    ]);
    await open();
    const items = within(await screen.findByRole('list', { name: 'Reports' })).getAllByRole(
      'listitem',
    );
    expect(items[0]).toHaveTextContent('20:00 h of 100:00 h used (20%) Within budget');
    expect(items[1]).toHaveTextContent('9:00 h of 10:00 h used (90%) Close to the budget');
    expect(items[2]).toHaveTextContent('15:00 h of 10:00 h used (150%) Over budget');
    expect(within(items[2]!).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(within(items[3]!).queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows rows without a client under a name of their own', async () => {
    as('hr');
    serve([row(1, { id: null, label: '', detail: null })]);
    await open();
    expect(await screen.findByText('No client')).toBeInTheDocument();
  });

  it('passes the grouping and the dates to the API', async () => {
    as('hr');
    const calls = serve();
    await open();
    const user = userEvent.setup();
    await screen.findByRole('list', { name: 'Reports' });
    await user.selectOptions(screen.getByLabelText('Group by'), 'person');
    await waitFor(() => expect(calls.reports.at(-1)!.searchParams.get('groupBy')).toBe('person'));
    const from = screen.getByLabelText('From');
    await user.clear(from);
    await user.type(from, '2026-09-01');
    await waitFor(() => expect(calls.reports.at(-1)!.searchParams.get('from')).toBe('2026-09-01'));
  });

  it('does not ask for a period that ends before it starts, or lasts more than a year', async () => {
    as('hr');
    const calls = serve();
    await open();
    await screen.findByRole('list', { name: 'Reports' });
    const before = calls.reports.length;
    const user = userEvent.setup();
    const to = screen.getByLabelText('To');
    await user.clear(to);
    await user.type(to, '2000-01-01');
    expect(await screen.findByText('The end cannot be before the start.')).toBeInTheDocument();
    const from = screen.getByLabelText('From');
    await user.clear(from);
    await user.type(from, '1990-01-01');
    expect(await screen.findByText('A report covers at most one year.')).toBeInTheDocument();
    await user.clear(from);
    await user.type(from, 'abc');
    expect(await screen.findByText('Enter a valid date as year-month-day.')).toBeInTheDocument();
    expect(calls.reports.length).toBe(before); // nothing was asked for
  });

  it('shows an empty state and an error with a retry', async () => {
    as('hr');
    serve([]);
    const { unmount } = await open();
    expect(await screen.findByText('No time logged in this period.')).toBeInTheDocument();
    unmount();
    server.use(http.get(`${API}/time/reports`, () => errorResponse('INTERNAL', 500)));
    await open();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('the export', () => {
  it('saves a CSV of the approved hours', async () => {
    as('hr');
    const calls = serve();
    let saved: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      saved = blob as Blob;
      return 'blob:csv';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Export approved hours (CSV)' }));
    expect(await screen.findByText('File saved with 1 lines.')).toBeInTheDocument();
    expect(calls.exports).toHaveLength(1);
    expect(calls.exports[0]!.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
    expect(saved?.type).toContain('text/csv');
    expect(await saved!.text()).toBe(
      'date,person,project_code,project_name,task,hours,billable\r\n' +
        '2026-10-26,Eva Employee,WEB-1,Website,,1.50,yes\r\n',
    );
  });

  it('is not offered without permission to export, and not for a bad period', async () => {
    server.use(
      ...signedInHandlers(
        userWithPermissions({ 'time.report_project': 'all', 'time.view': 'all' }),
      ),
    );
    serve();
    const { unmount } = await open();
    await screen.findByRole('list', { name: 'Reports' });
    expect(
      screen.queryByRole('button', { name: 'Export approved hours (CSV)' }),
    ).not.toBeInTheDocument();
    unmount();

    as('hr');
    serve();
    await open();
    const user = userEvent.setup();
    const to = await screen.findByLabelText('To');
    await user.clear(to);
    await user.type(to, '2000-01-01');
    expect(screen.getByRole('button', { name: 'Export approved hours (CSV)' })).toBeDisabled();
  });

  it('shows why an export failed', async () => {
    as('manager');
    serve();
    server.use(http.get(`${API}/time/reports/export`, () => errorResponse('FORBIDDEN', 403)));
    await open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Export approved hours (CSV)' }));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
  });
});
