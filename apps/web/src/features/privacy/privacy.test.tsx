import type { Employee, PersonalDataExport } from '@intime/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const ID = uuid(7);

const employee = (o: Partial<Employee> = {}): Employee => ({
  id: ID,
  firstName: 'Dan',
  lastName: 'Dimitrov',
  jobTitle: null,
  location: null,
  email: 'dan@acme.eu',
  status: 'inactive',
  department: null,
  manager: null,
  teams: [],
  isSelf: false,
  profile: null,
  ...o,
});

const document: PersonalDataExport = {
  schemaVersion: 1,
  generatedAt: '2026-10-25T08:00:00.000Z',
  account: null,
  employee: null,
  leave: { requests: [], balances: [] },
  projects: { assignments: [], led: [] },
  tasks: [],
  time: { entries: [], timesheets: [] },
  goals: { personal: [], checkIns: [] },
  oneOnOnes: [],
  feedback: { given: [], received: [] },
  ai: { consentAt: null, sharePeopleData: false, keys: [], conversations: [] },
  skills: [],
  reviews: [],
  attendance: [],
  calendarEvents: [],
  notifications: [],
  notificationPreferences: [],
  auditEntries: [],
};

const as = (role: 'employee' | 'manager' | 'hr' | 'admin') =>
  server.use(...signedInHandlers(userWithRole(role)));
const serve = (e: Employee) =>
  server.use(http.get(`${API}/employees/${e.id}`, () => HttpResponse.json(e)));

let saved: { name: string; text: Promise<string> }[];
beforeEach(() => {
  saved = [];
  let current = '';
  URL.createObjectURL = vi.fn((blob: Blob) => {
    current = 'blob:test';
    saved.push({ name: '', text: blob.text() });
    return current;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const last = saved.at(-1);
    if (last) last.name = this.download;
  });
});
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------------------------------
describe('download my data', () => {
  it('downloads the document as a JSON file from the own profile', async () => {
    server.use(
      http.get(`${API}/employees/me`, () =>
        HttpResponse.json(employee({ isSelf: true, status: 'active' })),
      ),
      http.get(`${API}/privacy/export`, () => HttpResponse.json(document)),
    );
    await renderApp('/profile');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Download my data' }));
    expect(await screen.findByText('Your file was downloaded.')).toBeInTheDocument();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toBe('intime-data-export.json');
    expect(JSON.parse(await saved[0]!.text)).toEqual(document);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('shows the API error and downloads nothing when the export fails', async () => {
    server.use(
      http.get(`${API}/employees/me`, () => HttpResponse.json(employee({ isSelf: true }))),
      http.get(`${API}/privacy/export`, () => errorResponse('INTERNAL_ERROR', 500)),
    );
    await renderApp('/profile');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Download my data' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(saved).toEqual([]);
  });

  it('is not offered without the permission', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'employee.view_directory': 'all' })),
      http.get(`${API}/employees/me`, () => HttpResponse.json(employee({ isSelf: true }))),
    );
    await renderApp('/profile');
    await screen.findByText('Dan Dimitrov');
    expect(screen.queryByRole('button', { name: 'Download my data' })).not.toBeInTheDocument();
  });

  it('is in German and Bulgarian', async () => {
    server.use(
      http.get(`${API}/employees/me`, () => HttpResponse.json(employee({ isSelf: true }))),
    );
    await initTestI18n('de');
    const { unmount } = await renderApp('/profile');
    expect(
      await screen.findByRole('button', { name: 'Meine Daten herunterladen' }),
    ).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/profile');
    expect(await screen.findByRole('button', { name: 'Изтегли моите данни' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('HR: export and erase', () => {
  it('offers export to HR, and nothing to employees and managers', async () => {
    serve(employee());
    as('employee');
    const first = await renderApp(`/employees/${ID}`);
    await screen.findByText('Dan Dimitrov');
    expect(screen.queryByText('Personal data')).not.toBeInTheDocument();
    first.unmount();
    as('manager');
    const second = await renderApp(`/employees/${ID}`);
    await screen.findByText('Dan Dimitrov');
    expect(screen.queryByText('Personal data')).not.toBeInTheDocument();
    second.unmount();
    as('hr');
    await renderApp(`/employees/${ID}`);
    expect(await screen.findByRole('button', { name: 'Download data' })).toBeInTheDocument();
  });

  it('downloads the employee export under a file name without personal data', async () => {
    as('hr');
    serve(employee());
    server.use(http.get(`${API}/privacy/export/${ID}`, () => HttpResponse.json(document)));
    await renderApp(`/employees/${ID}`);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Download data' }));
    expect(await screen.findByText(/The file was downloaded/)).toBeInTheDocument();
    expect(saved[0]!.name).toBe(`intime-data-export-${ID}.json`);
  });

  it('offers erasure only for former employees, and never for yourself', async () => {
    as('hr');
    serve(employee({ status: 'active' }));
    const first = await renderApp(`/employees/${ID}`);
    await screen.findByRole('button', { name: 'Download data' });
    expect(screen.queryByRole('button', { name: 'Erase personal data' })).not.toBeInTheDocument();
    first.unmount();
    serve(employee({ status: 'inactive', isSelf: true }));
    const second = await renderApp(`/employees/${ID}`);
    await screen.findByRole('button', { name: 'Download data' });
    expect(screen.queryByRole('button', { name: 'Erase personal data' })).not.toBeInTheDocument();
    second.unmount();
    serve(employee());
    await renderApp(`/employees/${ID}`);
    expect(await screen.findByRole('button', { name: 'Erase personal data' })).toBeInTheDocument();
  });

  it('shows no actions on an erased record, only the export', async () => {
    as('hr');
    serve(employee({ firstName: '—', lastName: '#6df443', erased: true }));
    await renderApp(`/employees/${ID}`);
    await screen.findByRole('button', { name: 'Download data' });
    expect(screen.queryByRole('button', { name: 'Erase personal data' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('explains what happens, needs a tick, and sends nothing when cancelled', async () => {
    as('hr');
    serve(employee());
    const calls: string[] = [];
    server.use(
      http.post(`${API}/privacy/erase/${ID}`, ({ request }) => {
        calls.push(request.url);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderApp(`/employees/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Erase personal data' }));
    expect(screen.getByText('Erase the personal data of Dan Dimitrov?')).toBeInTheDocument();
    expect(screen.getByText(/Removed: name/)).toBeInTheDocument();
    expect(screen.getByText(/Kept without personal details/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Erase permanently' });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Erase permanently' })).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('erases after confirmation, with the explicit body, and closes the panel', async () => {
    as('hr');
    serve(employee());
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/privacy/erase/${ID}`, async ({ request }) => {
        bodies.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderApp(`/employees/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Erase personal data' }));
    await user.click(
      screen.getByRole('checkbox', { name: 'I understand that this is irreversible.' }),
    );
    await user.click(screen.getByRole('button', { name: 'Erase permanently' }));
    await waitFor(() => expect(bodies).toEqual([{ confirm: true }]));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Erase permanently' })).not.toBeInTheDocument(),
    );
  });

  it.each([
    ['active', 'Deactivate the employee first. Only former employees can be erased.'],
    ['self', 'You cannot erase your own data.'],
    ['erased', 'The personal data of this employee was already erased.'],
  ])('says why an erasure was refused (%s)', async (field, text) => {
    as('hr');
    serve(employee());
    server.use(
      http.post(`${API}/privacy/erase/${ID}`, () =>
        errorResponse('CONFLICT', 409, { params: { field } }),
      ),
    );
    await renderApp(`/employees/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Erase personal data' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Erase permanently' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('shows a generic error for other failures', async () => {
    as('admin');
    serve(employee());
    server.use(http.post(`${API}/privacy/erase/${ID}`, () => errorResponse('FORBIDDEN', 403)));
    await renderApp(`/employees/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Erase personal data' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Erase permanently' }));
    expect(await screen.findByText('You are not allowed to do this.')).toBeInTheDocument();
  });
});
