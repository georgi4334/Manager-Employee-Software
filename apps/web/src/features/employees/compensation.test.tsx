import type { Compensation, Employee } from '@intime/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { initTestI18n } from '@/tests/i18n';
import { API, errorResponse, server, signedInHandlers, userWithRole } from '@/tests/server';
import { renderApp } from '@/tests/utils';

const uuid = (n: number) => `0192f5a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const employee = (o: Partial<Employee> = {}): Employee => ({
  id: uuid(1),
  firstName: 'Dan',
  lastName: 'Dimitrov',
  jobTitle: 'Engineer',
  location: 'Sofia',
  email: 'dan@acme.eu',
  status: 'active',
  department: null,
  manager: null,
  teams: [],
  isSelf: false,
  profile: {
    employeeNo: null,
    employmentType: 'full_time',
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

const state = (o: Partial<Compensation> = {}): Compensation => ({
  employeeId: uuid(1),
  items: [
    {
      id: uuid(50),
      validFrom: '2026-03-01',
      basis: 'monthly',
      amountMinor: 350050,
      currency: 'EUR',
      current: true,
    },
    {
      id: uuid(51),
      validFrom: '2025-01-01',
      basis: 'hourly',
      amountMinor: 1250,
      currency: 'BGN',
      current: false,
    },
  ],
  canManage: true,
  ...o,
});

interface Backend {
  state: Compensation;
  reads: number;
  calls: { method: string; path: string; body: unknown }[];
}

function serve(person: Employee, initial: Compensation): Backend {
  const backend: Backend = { state: initial, reads: 0, calls: [] };
  server.use(
    http.get(`${API}/employees/${person.id}`, () => HttpResponse.json(person)),
    http.get(`${API}/employees/${person.id}/compensation`, () => {
      backend.reads++;
      return HttpResponse.json(backend.state);
    }),
    http.put(`${API}/employees/${person.id}/compensation`, async ({ request }) => {
      const body = (await request.json()) as {
        validFrom: string;
        basis: 'monthly' | 'yearly' | 'hourly';
        amountMinor: number;
        currency: 'EUR' | 'BGN' | 'USD' | 'GBP' | 'CHF';
      };
      backend.calls.push({ method: 'PUT', path: 'compensation', body });
      backend.state = {
        ...backend.state,
        items: [{ id: uuid(52), ...body, current: true }],
      };
      return HttpResponse.json(backend.state);
    }),
    http.delete(`${API}/employees/${person.id}/compensation/:id`, ({ params }) => {
      backend.calls.push({ method: 'DELETE', path: String(params.id), body: null });
      backend.state = { ...backend.state, items: [] };
      return HttpResponse.json(backend.state);
    }),
  );
  return backend;
}

const as = (role: 'employee' | 'manager' | 'hr' | 'admin') =>
  server.use(...signedInHandlers(userWithRole(role)));
const open = async (person: Employee) => {
  await renderApp(`/employees/${person.id}`);
  const heading = await screen.findByRole('heading', { name: 'Compensation' });
  return within(heading.closest('div')!);
};

describe('compensation on the profile', () => {
  it('shows the records newest first with the one in force marked, for HR', async () => {
    as('hr');
    serve(employee(), state());
    const card = await open(employee());
    const list = await card.findByRole('list', { name: 'Pay records' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('€3,500.50 per month');
    expect(rows[0]).toHaveTextContent('In force');
    expect(rows[1]).toHaveTextContent('BGN');
    expect(rows[1]).toHaveTextContent('per hour');
    expect(rows[1]).not.toHaveTextContent('In force');
    expect(card.getByText(/does not calculate pay/)).toBeInTheDocument();
  });

  it.each(['employee', 'manager'] as const)(
    'is not rendered, and not even requested, for the %s role',
    async (role) => {
      as(role);
      const backend = serve(employee(), state());
      await renderApp(`/employees/${uuid(1)}`);
      await screen.findByRole('heading', { name: 'Working hours' }).catch(() => undefined);
      await screen.findByText('Dan Dimitrov');
      expect(screen.queryByRole('heading', { name: 'Compensation' })).not.toBeInTheDocument();
      expect(backend.reads).toBe(0);
    },
  );

  it('is not rendered for an erased person', async () => {
    as('hr');
    const backend = serve(employee({ erased: true }), state());
    await renderApp(`/employees/${uuid(1)}`);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('heading', { name: 'Compensation' })).not.toBeInTheDocument();
    expect(backend.reads).toBe(0);
  });

  it('says so when nothing has been recorded', async () => {
    as('hr');
    serve(employee(), state({ items: [] }));
    const card = await open(employee());
    expect(await card.findByText('No pay has been recorded yet.')).toBeInTheDocument();
  });

  it('shows the error when the records cannot be read', async () => {
    as('hr');
    server.use(
      http.get(`${API}/employees/${uuid(1)}`, () => HttpResponse.json(employee())),
      http.get(`${API}/employees/${uuid(1)}/compensation`, () => errorResponse('FORBIDDEN', 403)),
    );
    const card = await open(employee());
    expect(await card.findByText('You are not allowed to do this.')).toBeInTheDocument();
  });

  it('adds a record from the typed amount in minor units and shows the new state', async () => {
    as('hr');
    const backend = serve(employee(), state());
    const card = await open(employee());
    const user = userEvent.setup();
    await user.click(await card.findByRole('button', { name: 'Add or change pay' }));
    const form = within(screen.getByRole('form', { name: 'Compensation' }));
    await user.clear(form.getByLabelText('Amount'));
    await user.type(form.getByLabelText('Amount'), '4 100,5');
    await user.selectOptions(form.getByLabelText('Paid'), 'per year');
    await user.selectOptions(form.getByLabelText('Currency'), 'USD');
    await user.clear(form.getByLabelText('Valid from'));
    await user.type(form.getByLabelText('Valid from'), '2026-12-01');
    await user.click(form.getByRole('button', { name: 'Save pay' }));
    await waitFor(() => expect(backend.calls).toHaveLength(1));
    expect(backend.calls[0]!.body).toEqual({
      validFrom: '2026-12-01',
      basis: 'yearly',
      amountMinor: 410050,
      currency: 'USD',
    });
    expect(await card.findByText(/\$4,100\.50 per year/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Compensation' })).not.toBeInTheDocument();
  });

  it('checks the amount before sending anything', async () => {
    as('hr');
    const backend = serve(employee(), state({ items: [] }));
    const card = await open(employee());
    const user = userEvent.setup();
    await user.click(await card.findByRole('button', { name: 'Add or change pay' }));
    const form = within(screen.getByRole('form', { name: 'Compensation' }));
    await user.click(form.getByRole('button', { name: 'Save pay' }));
    expect(await form.findByText(/Enter an amount like 3500 or 3 500,50/)).toBeInTheDocument();
    await user.type(form.getByLabelText('Amount'), '10.505');
    await user.click(form.getByRole('button', { name: 'Save pay' }));
    expect(await form.findByRole('alert')).toHaveTextContent(/two decimals at most/);
    expect(backend.calls).toEqual([]);
  });

  it('removes a record', async () => {
    as('hr');
    const backend = serve(employee(), state());
    const card = await open(employee());
    await userEvent
      .setup()
      .click(await card.findByRole('button', { name: /Remove the record from .*2026/ }));
    await waitFor(() =>
      expect(backend.calls).toEqual([{ method: 'DELETE', path: uuid(50), body: null }]),
    );
    expect(await card.findByText('No pay has been recorded yet.')).toBeInTheDocument();
  });

  it('shows the error of a refused change', async () => {
    as('hr');
    serve(employee(), state());
    server.use(
      http.put(`${API}/employees/${uuid(1)}/compensation`, () => errorResponse('CONFLICT', 409)),
    );
    const card = await open(employee());
    const user = userEvent.setup();
    await user.click(await card.findByRole('button', { name: 'Add or change pay' }));
    const form = within(screen.getByRole('form', { name: 'Compensation' }));
    await user.clear(form.getByLabelText('Amount'));
    await user.type(form.getByLabelText('Amount'), '1000');
    await user.click(form.getByRole('button', { name: 'Save pay' }));
    expect(await form.findByRole('alert')).toBeInTheDocument();
  });

  it('offers no editing on one’s own profile, and says why', async () => {
    as('hr');
    serve(employee({ isSelf: true }), state());
    const card = await open(employee({ isSelf: true }));
    await card.findByRole('list', { name: 'Pay records' });
    expect(card.queryByRole('button', { name: 'Add or change pay' })).not.toBeInTheDocument();
    expect(card.queryByRole('button', { name: /Remove the record/ })).not.toBeInTheDocument();
    expect(card.getByText(/another HR or administrator account/)).toBeInTheDocument();
  });

  it('offers no editing to someone who may see pay but not change it', async () => {
    as('hr');
    serve(employee(), state({ canManage: false }));
    const card = await open(employee());
    await card.findByRole('list', { name: 'Pay records' });
    expect(card.queryByRole('button', { name: 'Add or change pay' })).not.toBeInTheDocument();
    expect(card.queryByRole('button', { name: /Remove the record/ })).not.toBeInTheDocument();
  });

  it('is in German and Bulgarian, with the amounts in the language’s own style', async () => {
    as('hr');
    serve(employee(), state());
    await initTestI18n('de');
    const { unmount } = await renderApp(`/employees/${uuid(1)}`);
    expect(await screen.findByRole('heading', { name: 'Vergütung' })).toBeInTheDocument();
    expect(await screen.findByText(/3\.500,50\s€ pro Monat/)).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp(`/employees/${uuid(1)}`);
    expect(await screen.findByRole('heading', { name: 'Възнаграждение' })).toBeInTheDocument();
    expect(await screen.findByText(/на месец/)).toBeInTheDocument();
  });
});
