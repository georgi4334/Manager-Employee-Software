import type { FeedbackItem } from '@intime/contracts';
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
const ME = { id: uuid(10), firstName: 'Maria', lastName: 'Mine' };
const DAN = { id: uuid(70), firstName: 'Dan', lastName: 'Dev' };
const EVE = { id: uuid(71), firstName: 'Eve', lastName: 'Eng' };

const item = (n: number, o: Partial<FeedbackItem> = {}): FeedbackItem => ({
  id: uuid(500 + n),
  from: DAN,
  to: ME,
  kind: 'praise',
  visibility: 'recipient',
  body: `Words ${n}`,
  createdAt: '2026-10-20T10:00:00Z',
  report: 'none',
  canReport: true,
  canRemove: false,
  canKeep: false,
  ...o,
});

const node = (p: typeof DAN) => ({
  ...p,
  managerId: null,
  departmentId: null,
  departmentName: null,
  position: null,
  email: null,
});

function serve(items: FeedbackItem[] = []) {
  const calls = {
    list: [] as URL[],
    post: [] as unknown[],
    del: [] as string[],
    report: [] as string[],
    keep: [] as string[],
  };
  server.use(
    http.get(`${API}/feedback`, ({ request }) => {
      calls.list.push(new URL(request.url));
      return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 25 });
    }),
    http.get(`${API}/org/chart`, () =>
      HttpResponse.json({ nodes: [node(DAN), node(EVE), node({ ...ME })] }),
    ),
    http.get(`${API}/employees/me`, () =>
      HttpResponse.json({ id: ME.id, firstName: ME.firstName, lastName: ME.lastName }),
    ),
    http.post(`${API}/feedback`, async ({ request }) => {
      calls.post.push(await request.json());
      return HttpResponse.json(item(9), { status: 201 });
    }),
    http.delete(`${API}/feedback/:id`, ({ params }) => {
      calls.del.push(String(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${API}/feedback/:id/report`, ({ params }) => {
      calls.report.push(String(params.id));
      return HttpResponse.json(item(1, { report: 'open', canReport: false }));
    }),
    http.post(`${API}/feedback/:id/keep`, ({ params }) => {
      calls.keep.push(String(params.id));
      return HttpResponse.json(item(1, { report: 'kept' }));
    }),
  );
  return calls;
}
const as = (role: 'employee' | 'manager' | 'hr' | 'admin') =>
  server.use(...signedInHandlers(userWithRole(role)));

describe('access and structure', () => {
  it('is not for people without a feedback permission', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    await renderApp('/feedback');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('offers received and given feedback to every employee, and reported only to moderators', async () => {
    for (const [role, tabs] of [
      ['employee', ['Received', 'Given']],
      ['manager', ['Received', 'Given']],
      ['hr', ['Received', 'Given', 'Reported']],
      ['admin', ['Given', 'Reported']],
    ] as const) {
      as(role);
      serve([]);
      const { unmount } = await renderApp('/feedback');
      await screen.findByRole('heading', { name: 'Feedback' });
      const group = screen.queryByRole('group', { name: 'Show feedback' });
      const names = group
        ? within(group)
            .getAllByRole('button')
            .map((b) => b.textContent)
        : [];
      expect(names, role).toEqual(tabs.length > 1 ? [...tabs] : []);
      unmount();
    }
  });

  it('is in German and Bulgarian', async () => {
    as('employee');
    serve([item(1)]);
    await initTestI18n('de');
    const { unmount } = await renderApp('/feedback');
    expect(await screen.findByRole('heading', { name: 'Feedback' })).toBeInTheDocument();
    expect(await screen.findByText(/Lob/)).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/feedback');
    expect(await screen.findByRole('heading', { name: 'Обратна връзка' })).toBeInTheDocument();
    expect(await screen.findByText(/Похвала/)).toBeInTheDocument();
  });
});

describe('reading feedback', () => {
  it('shows who wrote it, the kind, who may read it and the text', async () => {
    as('employee');
    serve([
      item(1),
      item(2, { kind: 'constructive', visibility: 'recipient_and_manager', from: EVE }),
    ]);
    await renderApp('/feedback');
    const rows = within(await screen.findByRole('list', { name: 'Received' })).getAllByRole(
      'listitem',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Dan Dev to Maria Mine');
    expect(rows[0]).toHaveTextContent('Praise');
    expect(rows[0]).toHaveTextContent('Only the recipient');
    expect(rows[0]).toHaveTextContent('Words 1');
    expect(rows[1]).toHaveTextContent('Eve Eng to Maria Mine');
    expect(rows[1]).toHaveTextContent('Constructive');
    expect(rows[1]).toHaveTextContent('Recipient, their manager and HR');
  });

  it('says so when there is nothing, and when loading fails', async () => {
    as('employee');
    serve([]);
    await renderApp('/feedback');
    expect(await screen.findByText('You have not received any feedback yet.')).toBeInTheDocument();
    server.use(http.get(`${API}/feedback`, () => errorResponse('INTERNAL_ERROR', 500)));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Given' }));
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('asks for the box that was chosen', async () => {
    as('hr');
    const calls = serve([item(1)]);
    await renderApp('/feedback');
    await screen.findByText('Words 1');
    expect(calls.list.at(-1)?.searchParams.get('box')).toBe('received');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Given' }));
    await waitFor(() => expect(calls.list.at(-1)?.searchParams.get('box')).toBe('given'));
    await user.click(screen.getByRole('button', { name: 'Reported' }));
    await waitFor(() => expect(calls.list.at(-1)?.searchParams.get('box')).toBe('reported'));
    expect(screen.getByRole('button', { name: 'Reported' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('lets a manager and HR read what was shared with a person’s manager, and employees not', async () => {
    as('manager');
    const calls = serve([item(1)]);
    await renderApp('/feedback');
    const select = await screen.findByLabelText('Whose feedback');
    await userEvent.setup().selectOptions(select, DAN.id);
    await waitFor(() => expect(calls.list.at(-1)?.searchParams.get('employeeId')).toBe(DAN.id));
  });

  it('shows employees no way to read other people’s feedback', async () => {
    as('employee');
    serve([item(1)]);
    await renderApp('/feedback');
    await screen.findByText('Words 1');
    expect(screen.queryByLabelText('Whose feedback')).not.toBeInTheDocument();
  });
});

describe('giving feedback', () => {
  it('sends feedback to a colleague, never offering yourself', async () => {
    as('employee');
    const calls = serve([]);
    await renderApp('/feedback');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Give feedback' }));
    const form = screen.getByRole('form', { name: 'Give feedback' });
    await waitFor(() =>
      expect(within(within(form).getByLabelText('To')).getAllByRole('option')).toHaveLength(3),
    );
    expect(
      within(within(form).getByLabelText('To'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['—', 'Dan Dev', 'Eve Eng']);
    await user.selectOptions(within(form).getByLabelText('To'), EVE.id);
    await user.selectOptions(within(form).getByLabelText('Kind'), 'constructive');
    await user.selectOptions(
      within(form).getByLabelText('Who may read it'),
      'recipient_and_manager',
    );
    await user.type(within(form).getByLabelText('Your feedback'), ' Please plan earlier ');
    await user.click(within(form).getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(calls.post).toEqual([
        {
          toEmployeeId: EVE.id,
          kind: 'constructive',
          visibility: 'recipient_and_manager',
          body: 'Please plan earlier',
        },
      ]),
    );
    expect(await screen.findByText('Feedback sent.')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Give feedback' })).not.toBeInTheDocument();
  });

  it('is private praise unless chosen otherwise', async () => {
    as('employee');
    const calls = serve([]);
    await renderApp('/feedback');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Give feedback' }));
    const form = screen.getByRole('form', { name: 'Give feedback' });
    await waitFor(() =>
      expect(
        within(within(form).getByLabelText('To')).getAllByRole('option').length,
      ).toBeGreaterThan(1),
    );
    await user.selectOptions(within(form).getByLabelText('To'), DAN.id);
    await user.type(within(form).getByLabelText('Your feedback'), 'Thanks');
    await user.click(within(form).getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(calls.post).toEqual([
        { toEmployeeId: DAN.id, kind: 'praise', visibility: 'recipient', body: 'Thanks' },
      ]),
    );
  });

  it('does not send an incomplete form', async () => {
    as('employee');
    const calls = serve([]);
    await renderApp('/feedback');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Give feedback' }));
    const form = screen.getByRole('form', { name: 'Give feedback' });
    await user.click(within(form).getByRole('button', { name: 'Send' }));
    expect(await within(form).findAllByText('This field is required.')).toHaveLength(2);
    expect(calls.post).toEqual([]);
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Give feedback' })).not.toBeInTheDocument();
  });

  it('says exactly what the server refused', async () => {
    as('employee');
    serve([]);
    server.use(
      http.post(`${API}/feedback`, () =>
        errorResponse('VALIDATION_FAILED', 400, {
          details: [{ path: 'toEmployeeId', code: 'unknown_employee', message: 'x' }],
        }),
      ),
    );
    await renderApp('/feedback');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Give feedback' }));
    const form = screen.getByRole('form', { name: 'Give feedback' });
    await waitFor(() =>
      expect(
        within(within(form).getByLabelText('To')).getAllByRole('option').length,
      ).toBeGreaterThan(1),
    );
    await user.selectOptions(within(form).getByLabelText('To'), DAN.id);
    await user.type(within(form).getByLabelText('Your feedback'), 'Hi');
    await user.click(within(form).getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText('This person does not exist or is no longer active.'),
    ).toBeInTheDocument();
  });
});

describe('reporting and moderating', () => {
  it('lets the recipient report an item, and says when it was already reported', async () => {
    as('employee');
    const calls = serve([item(1)]);
    await renderApp('/feedback');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Report to a moderator' }));
    await waitFor(() => expect(calls.report).toEqual([uuid(501)]));
    server.use(
      http.post(`${API}/feedback/:id/report`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'report' } }),
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Report to a moderator' }));
    expect(await screen.findByText('This feedback was already reported.')).toBeInTheDocument();
  });

  it('offers no report on an item that cannot be reported', async () => {
    as('employee');
    serve([
      item(1, { canReport: false, report: 'open' }),
      item(2, { canReport: false, report: 'kept' }),
    ]);
    await renderApp('/feedback');
    expect(await screen.findByText('Reported to a moderator')).toBeInTheDocument();
    expect(screen.getByText('Reviewed by a moderator and kept')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report to a moderator' })).not.toBeInTheDocument();
  });

  it('asks twice before the giver removes feedback', async () => {
    as('employee');
    const calls = serve([item(1, { from: ME, to: DAN, canReport: false, canRemove: true })]);
    await renderApp('/feedback?box=given');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(calls.del).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Yes, remove it' }));
    await waitFor(() => expect(calls.del).toEqual([uuid(501)]));
  });

  it('lets a moderator keep or remove a reported item', async () => {
    as('hr');
    const calls = serve([
      item(1, { report: 'open', canReport: false, canKeep: true, canRemove: true }),
    ]);
    await renderApp('/feedback?box=reported');
    const user = userEvent.setup();
    expect(await screen.findByText('Words 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    await waitFor(() => expect(calls.keep).toEqual([uuid(501)]));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Yes, remove it' }));
    await waitFor(() => expect(calls.del).toEqual([uuid(501)]));
  });

  it('shows no actions on feedback that is only to be read', async () => {
    as('manager');
    serve([item(1, { canReport: false })]);
    await renderApp('/feedback');
    await screen.findByText('Words 1');
    for (const name of ['Report to a moderator', 'Keep it', 'Remove']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });
});
