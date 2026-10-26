import type { Capacity, CapacityPerson } from '@intime/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { initTestI18n } from '@/tests/i18n';
import { API, errorResponse, server, signedInHandlers, userWithPermissions } from '@/tests/server';
import { renderApp } from '@/tests/utils';

const uuid = (n: number) => `0192f5a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const person = (n: number, o: Partial<CapacityPerson> = {}): CapacityPerson => ({
  employee: { id: uuid(n), firstName: `Person${n}`, lastName: 'Test' },
  availableMinutes: 1680,
  plannedMinutes: 600,
  loggedMinutes: 300,
  overtimeMinutes: 0,
  freeMinutes: 1080,
  level: 'busy',
  days: [0, 1, 2, 3, 4, 5, 6].map((i) => ({
    date: `2026-10-${26 + i}`,
    availableMinutes: i < 5 ? 480 : 0,
    plannedMinutes: i < 5 ? 120 : 0,
    loggedMinutes: i === 0 ? 90 : 0,
    status: i < 5 ? ('busy' as const) : ('off' as const),
  })),
  projects: [
    { id: uuid(9), code: 'WEB-1', name: 'Website', plannedMinutes: 600, loggedMinutes: 300 },
  ],
  ...o,
});

function serve(items: CapacityPerson[] = [person(1)], total = items.length) {
  const calls = { capacity: [] as URL[] };
  server.use(
    http.get(`${API}/capacity`, ({ request }) => {
      calls.capacity.push(new URL(request.url));
      return HttpResponse.json({
        from: '2026-10-26',
        to: '2026-11-01',
        items,
        total,
        page: 1,
        pageSize: 25,
      } satisfies Capacity);
    }),
    http.get(`${API}/projects`, () =>
      HttpResponse.json({
        items: [
          {
            id: uuid(9),
            code: 'WEB-1',
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
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      }),
    ),
  );
  return calls;
}

describe('access', () => {
  it('is for people with the capacity permission only', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    await renderApp('/capacity');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('needs the capacity permission and nothing else', async () => {
    server.use(...signedInHandlers(userWithPermissions({ 'capacity.view': 'own' })));
    serve();
    await renderApp('/capacity');
    expect(await screen.findByRole('heading', { name: 'Capacity' })).toBeInTheDocument();
    expect(await screen.findByText('Person1 Test')).toBeInTheDocument();
  });

  it('is in German and Bulgarian', async () => {
    serve();
    await initTestI18n('de');
    const { unmount } = await renderApp('/capacity');
    expect(await screen.findByRole('heading', { name: 'Kapazität' })).toBeInTheDocument();
    expect(await screen.findByText('Ausgelastet')).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/capacity');
    expect(await screen.findByRole('heading', { name: 'Капацитет' })).toBeInTheDocument();
    expect(await screen.findByText('Зает')).toBeInTheDocument();
  });
});

describe('overtime', () => {
  it('is shown in words when there is some, and not otherwise', async () => {
    serve([person(1, { overtimeMinutes: 270 }), person(2)]);
    await renderApp('/capacity');
    const first = (await screen.findByText('Person1 Test')).closest('li')!;
    expect(first).toHaveTextContent('Overtime 4:30 h: logged beyond the available time');
    const second = screen.getByText('Person2 Test').closest('li')!;
    expect(second).not.toHaveTextContent('Overtime');
  });
});

describe('the list', () => {
  it('asks for the current week and shows the numbers and the level in words', async () => {
    const calls = serve();
    await renderApp('/capacity');
    const card = (await screen.findByText('Person1 Test')).closest('li')!;
    expect(card).toHaveTextContent('Busy');
    expect(card).toHaveTextContent(
      'Available 28:00 h · planned 10:00 h · logged 5:00 h · free 18:00 h',
    );
    const q = calls.capacity.at(-1)!.searchParams;
    expect(new Date(`${q.get('from')}T00:00:00Z`).getUTCDay()).toBe(1); // a Monday
    expect(q.get('to')).toBe(
      new Date(Date.parse(`${q.get('from')}T00:00:00Z`) + 6 * 86_400_000)
        .toISOString()
        .slice(0, 10),
    );
    expect(q.has('projectId')).toBe(false);
    expect(screen.getByText(/each person's own working hours/)).toBeInTheDocument();
  });

  it('shows days and projects on demand, with over-booking and leave in words', async () => {
    serve([
      person(1, {
        level: 'over',
        days: person(1).days.map((d, i) =>
          i === 1
            ? { ...d, status: 'over' as const, plannedMinutes: 528 }
            : i === 2
              ? { ...d, status: 'leave' as const, availableMinutes: 0, plannedMinutes: 0 }
              : d,
        ),
        projects: [
          { id: uuid(9), code: 'WEB-1', name: 'Website', plannedMinutes: 600, loggedMinutes: 300 },
          { id: null, code: null, name: null, plannedMinutes: 60, loggedMinutes: 0 },
        ],
      }),
    ]);
    await renderApp('/capacity');
    const card = (await screen.findByText('Person1 Test')).closest('li')!;
    expect(card).toHaveTextContent('Over-booked');
    const days = within(card).getByRole('list', { name: 'Days of Person1 Test' });
    const rows = within(days).getAllByRole('listitem');
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveTextContent('Busy · planned 2:00 of 8:00 h · logged 1:30 h');
    expect(rows[1]).toHaveTextContent('Over-booked · planned 8:48 of 8:00 h');
    expect(rows[2]).toHaveTextContent('Leave');
    expect(rows[2]).not.toHaveTextContent('planned');
    expect(rows[5]).toHaveTextContent('Not working');
    const projects = within(card).getByRole('list', { name: 'Projects of Person1 Test' });
    expect(within(projects).getByText('WEB-1 · Website')).toBeInTheDocument();
    expect(within(projects).getByText('Other projects')).toBeInTheDocument();
  });

  it('shows an empty state, an error with a retry, and a count', async () => {
    serve([]);
    const { unmount } = await renderApp('/capacity');
    expect(await screen.findByText('Nobody to show for this week.')).toBeInTheDocument();
    unmount();
    serve([person(1), person(2)]);
    const second = await renderApp('/capacity');
    expect(await screen.findByText('2 people')).toBeInTheDocument();
    second.unmount();
    server.use(http.get(`${API}/capacity`, () => errorResponse('INTERNAL', 500)));
    await renderApp('/capacity');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('puts the person with the most free time first, when asked', async () => {
    serve([
      person(1, { freeMinutes: 60 }),
      person(2, { freeMinutes: 900 }),
      person(3, { freeMinutes: 300 }),
    ]);
    await renderApp('/capacity');
    const names = () =>
      within(screen.getByRole('list', { name: 'Capacity' }))
        .getAllByRole('listitem')
        .filter((li) => li.matches('ul[aria-label="Capacity"] > li'))
        .map((li) => li.querySelector('p')?.textContent);
    await screen.findByText('Person1 Test');
    expect(names()).toEqual(['Person1 Test', 'Person2 Test', 'Person3 Test']);
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Most free time first' }));
    expect(names()).toEqual(['Person2 Test', 'Person3 Test', 'Person1 Test']);
  });
});

describe('the controls', () => {
  it('moves between weeks and back', async () => {
    const calls = serve();
    await renderApp('/capacity');
    await screen.findByText('Person1 Test');
    const heading = () => screen.getByRole('heading', { name: /Week of/ }).textContent;
    const first = heading();
    const firstFrom = calls.capacity.at(-1)!.searchParams.get('from')!;
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(() => expect(heading()).not.toBe(first));
    await waitFor(() =>
      expect(calls.capacity.at(-1)!.searchParams.get('from')! > firstFrom).toBe(true),
    );
    await user.click(await screen.findByRole('button', { name: 'This week' }));
    await waitFor(() => expect(heading()).toBe(first));
    expect(screen.queryByRole('button', { name: 'This week' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    await waitFor(() =>
      expect(calls.capacity.at(-1)!.searchParams.get('from')! < firstFrom).toBe(true),
    );
  });

  it('passes the name and the project to the API', async () => {
    const calls = serve();
    await renderApp('/capacity');
    const user = userEvent.setup();
    await screen.findByText('Person1 Test');
    await user.selectOptions(screen.getByLabelText('Project'), uuid(9));
    await user.type(screen.getByRole('searchbox'), 'ann');
    await waitFor(() => {
      const q = calls.capacity.at(-1)!.searchParams;
      expect([q.get('projectId'), q.get('q')]).toEqual([uuid(9), 'ann']);
    });
  });

  it('pages when there are more people than fit', async () => {
    const calls = serve([person(1)], 60);
    await renderApp('/capacity');
    const user = userEvent.setup();
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(calls.capacity.at(-1)!.searchParams.get('page')).toBe('2'));
  });
});
