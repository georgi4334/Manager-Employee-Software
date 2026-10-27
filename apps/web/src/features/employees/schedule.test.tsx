import type { Employee, WorkSchedules } from '@intime/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { initTestI18n } from '@/tests/i18n';
import { API, errorResponse, server, signedInHandlers, userWithRole } from '@/tests/server';
import { renderApp } from '@/tests/utils';

const uuid = (n: number) => `0192f5a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PART_TIME = [240, 240, 240, 240, 0, 480, 0];

const employee = (o: Partial<Employee> = {}): Employee => ({
  id: uuid(1),
  firstName: 'Pat',
  lastName: 'Part',
  jobTitle: 'Engineer',
  location: 'Sofia',
  email: 'pat@acme.eu',
  status: 'active',
  department: null,
  manager: null,
  teams: [],
  isSelf: false,
  profile: {
    employeeNo: null,
    employmentType: 'part_time',
    seniority: null,
    hireDate: '2024-01-15',
    terminationDate: null,
    birthDate: null,
    phone: null,
    country: 'BG',
    accountStatus: 'active',
  },
  ...o,
});

const state = (o: Partial<WorkSchedules> = {}): WorkSchedules => ({
  employeeId: uuid(1),
  effective: PART_TIME,
  isDefault: false,
  items: [{ id: uuid(50), validFrom: '2026-03-02', minutes: PART_TIME, current: true }],
  canManage: false,
  ...o,
});

interface Backend {
  state: WorkSchedules;
  calls: { method: string; path: string; body: unknown }[];
  schedulesRequested: number;
}

function serve(person: Employee, initial: WorkSchedules): Backend {
  const backend: Backend = { state: initial, calls: [], schedulesRequested: 0 };
  server.use(
    http.get(`${API}/employees/${person.id}`, () => HttpResponse.json(person)),
    // HR also sees the compensation card (ADR 0030); this file is about working hours
    http.get(`${API}/employees/${person.id}/compensation`, () =>
      HttpResponse.json({ employeeId: person.id, items: [], canManage: false }),
    ),
    http.get(`${API}/employees/${person.id}/schedule`, () => {
      backend.schedulesRequested++;
      return HttpResponse.json(backend.state);
    }),
    http.put(`${API}/employees/${person.id}/schedule`, async ({ request }) => {
      const body = (await request.json()) as { validFrom: string; minutes: number[] };
      backend.calls.push({ method: 'PUT', path: 'schedule', body });
      backend.state = {
        ...backend.state,
        effective: body.minutes,
        isDefault: false,
        items: [{ id: uuid(51), validFrom: body.validFrom, minutes: body.minutes, current: true }],
      };
      return HttpResponse.json(backend.state);
    }),
    http.delete(`${API}/employees/${person.id}/schedule/:id`, ({ params }) => {
      backend.calls.push({ method: 'DELETE', path: String(params.id), body: null });
      backend.state = {
        ...backend.state,
        items: [],
        isDefault: true,
        effective: [480, 480, 480, 480, 480, 0, 0],
      };
      return HttpResponse.json(backend.state);
    }),
  );
  return backend;
}

const asHr = () => server.use(...signedInHandlers(userWithRole('hr')));

describe('working hours on the profile', () => {
  it('shows the hours per weekday, the weekly total and the changes, without edit controls for viewers', async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    serve(employee(), state());
    await renderApp(`/employees/${uuid(1)}`);
    const card = (await screen.findByRole('heading', { name: 'Working hours' })).closest('div')!;
    const week = await within(card).findByRole('list', { name: 'Hours per weekday' });
    expect(within(week).getByText('Monday').nextSibling).toHaveTextContent('4:00 h');
    expect(within(week).getByText('Friday').nextSibling).toHaveTextContent('Day off');
    expect(within(week).getByText('Saturday').nextSibling).toHaveTextContent('8:00 h');
    expect(within(card).getByText('Per week: 24:00 h')).toBeInTheDocument();
    expect(within(card).getByText(/In force/)).toBeInTheDocument();
    expect(
      within(card).queryByRole('button', { name: 'Change working hours' }),
    ).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it('says that the standard week applies while nothing is set', async () => {
    asHr();
    serve(
      employee(),
      state({
        isDefault: true,
        items: [],
        effective: [480, 480, 480, 480, 480, 0, 0],
        canManage: true,
      }),
    );
    await renderApp(`/employees/${uuid(1)}`);
    expect(await screen.findByText(/Standard week: 8 hours, Monday to Friday/)).toBeInTheDocument();
    expect(screen.getByText('Per week: 40:00 h')).toBeInTheDocument();
  });

  it('is not shown, and not requested, without access to the full profile', async () => {
    server.use(...signedInHandlers(userWithRole('employee')));
    const backend = serve(employee({ profile: null }), state());
    await renderApp(`/employees/${uuid(1)}`);
    await screen.findByText('Pat Part');
    expect(screen.queryByRole('heading', { name: 'Working hours' })).not.toBeInTheDocument();
    expect(backend.schedulesRequested).toBe(0);
  });

  it('is not shown for an erased person', async () => {
    asHr();
    const backend = serve(employee({ erased: true }), state());
    await renderApp(`/employees/${uuid(1)}`);
    await screen.findAllByText(/Part|—/);
    expect(screen.queryByRole('heading', { name: 'Working hours' })).not.toBeInTheDocument();
    expect(backend.schedulesRequested).toBe(0);
  });

  it('shows an error when the hours cannot be loaded', async () => {
    asHr();
    serve(employee(), state());
    server.use(
      http.get(`${API}/employees/${uuid(1)}/schedule`, () => errorResponse('INTERNAL_ERROR', 500)),
    );
    await renderApp(`/employees/${uuid(1)}`);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('is in German and Bulgarian', async () => {
    asHr();
    serve(employee(), state());
    await initTestI18n('de');
    const { unmount } = await renderApp(`/employees/${uuid(1)}`);
    expect(await screen.findByRole('heading', { name: 'Arbeitszeit' })).toBeInTheDocument();
    expect(await screen.findByText('Montag')).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp(`/employees/${uuid(1)}`);
    expect(await screen.findByRole('heading', { name: 'Работно време' })).toBeInTheDocument();
    expect(await screen.findByText('понеделник')).toBeInTheDocument();
  });
});

describe('changing the working hours', () => {
  it('opens a form filled with the current week, checks it and sends minutes from today on', async () => {
    asHr();
    const backend = serve(employee(), state({ canManage: true }));
    await renderApp(`/employees/${uuid(1)}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Change working hours' }));
    const form = screen.getByRole('form', { name: 'Working hours' });
    expect(within(form).getByLabelText('Monday')).toHaveValue('4:00');
    expect(within(form).getByLabelText('Friday')).toHaveValue('');
    expect(within(form).getByLabelText('Saturday')).toHaveValue('8:00');

    await userEvent.clear(within(form).getByLabelText('Monday'));
    await userEvent.type(within(form).getByLabelText('Monday'), '17');
    await userEvent.click(within(form).getByRole('button', { name: 'Save working hours' }));
    expect(
      await within(form).findByText(/duration like 1:30 or 1.5, up to 16 hours/),
    ).toBeInTheDocument();
    expect(backend.calls).toHaveLength(0);

    await userEvent.clear(within(form).getByLabelText('Monday'));
    await userEvent.type(within(form).getByLabelText('Monday'), '8');
    await userEvent.clear(within(form).getByLabelText('Saturday'));
    await userEvent.type(within(form).getByLabelText('Friday'), '7,5');
    await userEvent.click(within(form).getByRole('button', { name: 'Save working hours' }));
    await waitFor(() => expect(backend.calls).toHaveLength(1));
    const body = backend.calls[0]!.body as { validFrom: string; minutes: number[] };
    expect(body.minutes).toEqual([480, 240, 240, 240, 450, 0, 0]);
    expect(body.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // the form closes and the card shows the new week
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Working hours' })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Per week: 27:30 h')).toBeInTheDocument();
  });

  it('removes a change', async () => {
    asHr();
    const backend = serve(employee(), state({ canManage: true }));
    await renderApp(`/employees/${uuid(1)}`);
    await userEvent.click(await screen.findByRole('button', { name: /^Remove the change from/ }));
    await waitFor(() =>
      expect(backend.calls).toEqual([{ method: 'DELETE', path: uuid(50), body: null }]),
    );
    expect(await screen.findByText(/Standard week: 8 hours/)).toBeInTheDocument();
  });

  it('shows the API error and keeps the form open', async () => {
    asHr();
    serve(employee(), state({ canManage: true }));
    server.use(
      http.put(`${API}/employees/${uuid(1)}/schedule`, () => errorResponse('FORBIDDEN', 403)),
    );
    await renderApp(`/employees/${uuid(1)}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Change working hours' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save working hours' }));
    expect(await screen.findByText(/not allowed/i)).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Working hours' })).toBeInTheDocument();
  });

  it('can be cancelled without sending anything', async () => {
    asHr();
    const backend = serve(employee(), state({ canManage: true }));
    await renderApp(`/employees/${uuid(1)}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Change working hours' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Working hours' })).not.toBeInTheDocument();
    expect(backend.calls).toHaveLength(0);
  });
});
