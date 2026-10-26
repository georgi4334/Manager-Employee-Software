import type { RetentionOverview } from '@intime/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { initTestI18n } from '@/tests/i18n';
import { API, errorResponse, server, signedInHandlers, userWithRole } from '@/tests/server';
import { renderApp } from '@/tests/utils';

const uuid = (n: number) => `0192f5a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const overview = (o: Partial<RetentionOverview> = {}): RetentionOverview => ({
  policy: {
    country: 'BG',
    enabled: false,
    formerEmployeeMonths: 60,
    lastRunAt: null,
    lastRunErased: 0,
    presetMonths: 60,
  },
  today: '2026-10-26',
  candidates: [
    {
      employeeId: uuid(1),
      name: 'Dora Former',
      terminationDate: '2021-03-15',
      dueDate: '2026-03-15',
      due: true,
      held: false,
    },
    {
      employeeId: uuid(2),
      name: 'Hugo Former',
      terminationDate: '2021-01-10',
      dueDate: '2026-01-10',
      due: true,
      held: true,
    },
    {
      employeeId: uuid(3),
      name: 'Sam Former',
      terminationDate: '2021-12-01',
      dueDate: '2026-12-01',
      due: false,
      held: false,
    },
  ],
  withoutTerminationDate: 0,
  ...o,
});

interface Backend {
  state: RetentionOverview;
  calls: { method: string; path: string; body: unknown }[];
}

function serve(initial: RetentionOverview = overview()): Backend {
  const backend: Backend = { state: initial, calls: [] };
  server.use(
    http.get(`${API}/privacy/retention`, () => HttpResponse.json(backend.state)),
    http.put(`${API}/privacy/retention`, async ({ request }) => {
      const body = (await request.json()) as { enabled?: boolean; formerEmployeeMonths?: number };
      backend.calls.push({ method: 'PUT', path: 'policy', body });
      backend.state = {
        ...backend.state,
        policy: {
          ...backend.state.policy,
          enabled: body.enabled ?? backend.state.policy.enabled,
          formerEmployeeMonths:
            body.formerEmployeeMonths ?? backend.state.policy.formerEmployeeMonths,
        },
      };
      return HttpResponse.json(backend.state);
    }),
    http.put(`${API}/privacy/retention/holds/:id`, async ({ request, params }) => {
      const body = (await request.json()) as { held: boolean };
      backend.calls.push({ method: 'PUT', path: `hold/${String(params.id)}`, body });
      backend.state = {
        ...backend.state,
        candidates: backend.state.candidates.map((c) =>
          c.employeeId === params.id ? { ...c, held: body.held } : c,
        ),
      };
      return HttpResponse.json(backend.state);
    }),
  );
  return backend;
}

beforeEach(() => server.use(...signedInHandlers(userWithRole('hr'))));

describe('access', () => {
  it('is for people who manage retention only', async () => {
    server.use(...signedInHandlers(userWithRole('employee')));
    serve();
    await renderApp('/retention');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('is in German and Bulgarian', async () => {
    serve();
    await initTestI18n('de');
    const { unmount } = await renderApp('/retention');
    expect(
      await screen.findByRole('heading', { name: 'Datenaufbewahrung', level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Bulgarien')).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/retention');
    expect(
      await screen.findByRole('heading', { name: 'Съхранение на данни', level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByText('България')).toBeInTheDocument();
  });
});

describe('the page', () => {
  it('shows Bulgaria, that it is off, the default period and that this is not legal advice', async () => {
    serve();
    await renderApp('/retention');
    expect(await screen.findByText('Bulgaria')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText('Has not run yet')).toBeInTheDocument();
    expect(screen.getByText(/not legal advice/)).toBeInTheDocument();
    expect(screen.getByLabelText('Months after the termination date')).toHaveValue('60');
    expect(screen.getByText(/Default for Bulgaria: 60/)).toBeInTheDocument();
  });

  it('shows who is due or on hold in words, and who falls due later', async () => {
    serve();
    await renderApp('/retention');
    const list = (
      await screen.findByRole('heading', { name: 'Due now or within 90 days' })
    ).closest('section')!;
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Dora Former');
    expect(items[0]).toHaveTextContent('Due');
    expect(items[1]).toHaveTextContent('On hold');
    expect(items[2]).not.toHaveTextContent('Due');
  });

  it('says so when nobody is due, and counts people without a termination date', async () => {
    serve(overview({ candidates: [], withoutTerminationDate: 2 }));
    await renderApp('/retention');
    expect(await screen.findByText('Nobody is due.')).toBeInTheDocument();
    expect(
      screen.getByText(
        '2 former employees have no termination date and are never erased automatically.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the last run', async () => {
    const base = overview();
    serve({
      ...base,
      policy: {
        ...base.policy,
        enabled: true,
        lastRunAt: '2026-10-25T04:00:00.000Z',
        lastRunErased: 3,
      },
    });
    await renderApp('/retention');
    expect(await screen.findByText(/3 people anonymised/)).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    server.use(http.get(`${API}/privacy/retention`, () => errorResponse('INTERNAL_ERROR', 500)));
    await renderApp('/retention');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('switching it on and off', () => {
  it('asks for confirmation first, and does nothing when cancelled', async () => {
    const backend = serve();
    await renderApp('/retention');
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    expect(
      screen.getByText(/anonymised 60 months after their termination date/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
    expect(backend.calls).toHaveLength(0);
  });

  it('turns it on after the confirmation and off again at once', async () => {
    const backend = serve();
    await renderApp('/retention');
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, turn on' }));
    expect(await screen.findByRole('button', { name: 'Turn off' })).toBeInTheDocument();
    expect(backend.calls[0]).toEqual({ method: 'PUT', path: 'policy', body: { enabled: true } });
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeInTheDocument();
    expect(backend.calls[1]?.body).toEqual({ enabled: false });
  });

  it('shows the API error when saving fails', async () => {
    serve();
    server.use(http.put(`${API}/privacy/retention`, () => errorResponse('FORBIDDEN', 403)));
    await renderApp('/retention');
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, turn on' }));
    expect(await screen.findByText(/not allowed/i)).toBeInTheDocument();
  });
});

describe('the period', () => {
  it('checks the number before sending and saves a valid one', async () => {
    const backend = serve();
    await renderApp('/retention');
    const form = await screen.findByRole('form', { name: 'Retention period' });
    const input = within(form).getByLabelText('Months after the termination date');
    for (const bad of ['6', '601', 'x']) {
      await userEvent.clear(input);
      await userEvent.type(input, bad);
      await userEvent.click(within(form).getByRole('button', { name: 'Save period' }));
      expect(await within(form).findByRole('alert')).toBeInTheDocument();
    }
    expect(backend.calls).toHaveLength(0);
    await userEvent.clear(input);
    await userEvent.type(input, '36');
    await userEvent.click(within(form).getByRole('button', { name: 'Save period' }));
    await waitFor(() => expect(backend.calls).toHaveLength(1));
    expect(backend.calls[0]?.body).toEqual({ formerEmployeeMonths: 36 });
  });
});

describe('legal hold', () => {
  it('puts a person on hold and releases the hold again', async () => {
    const backend = serve();
    await renderApp('/retention');
    await userEvent.click(await screen.findByRole('button', { name: 'Put Dora Former on hold' }));
    await waitFor(() =>
      expect(backend.calls[0]).toEqual({
        method: 'PUT',
        path: `hold/${uuid(1)}`,
        body: { held: true },
      }),
    );
    expect(
      await screen.findByRole('button', { name: 'Release the hold on Dora Former' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Release the hold on Hugo Former' }));
    await waitFor(() =>
      expect(backend.calls[1]).toEqual({
        method: 'PUT',
        path: `hold/${uuid(2)}`,
        body: { held: false },
      }),
    );
  });

  it('shows an error when the hold cannot be set', async () => {
    serve();
    server.use(
      http.put(`${API}/privacy/retention/holds/:id`, () => errorResponse('NOT_FOUND', 404)),
    );
    await renderApp('/retention');
    await userEvent.click(await screen.findByRole('button', { name: 'Put Dora Former on hold' }));
    expect(await screen.findByText(/could not find/i)).toBeInTheDocument();
  });
});
