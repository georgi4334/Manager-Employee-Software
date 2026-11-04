import type { ChecklistSummary, Employee } from '@intime/contracts';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { initTestI18n } from '@/tests/i18n';
import { API, errorResponse, server, signedInHandlers, userWithRole } from '@/tests/server';
import { renderApp } from '@/tests/utils';

const uuid = (n: number) => `0192f5a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const person = (o: Partial<Employee> = {}): Employee => ({
  id: uuid(1),
  firstName: 'Nina',
  lastName: 'New',
  jobTitle: 'Engineer',
  location: 'Sofia',
  email: 'nina@acme.eu',
  status: 'active',
  department: null,
  manager: null,
  teams: [],
  isSelf: false,
  profile: {
    employeeNo: null,
    employmentType: 'full_time',
    seniority: null,
    hireDate: '2026-11-02',
    terminationDate: null,
    birthDate: null,
    phone: null,
    country: 'BG',
    accountStatus: 'active',
  },
  ...o,
});

const summary = (o: Partial<ChecklistSummary> = {}): ChecklistSummary => ({
  id: uuid(20),
  employee: { id: uuid(1), firstName: 'Nina', lastName: 'New' },
  kind: 'onboarding',
  name: 'Standard onboarding',
  anchorDate: '2026-11-02',
  status: 'open',
  done: 1,
  total: 4,
  overdue: 0,
  createdAt: '2026-11-01T08:00:00Z',
  ...o,
});

/** Answers the profile and the checklists about the person; records the checklist queries. */
function serve(employee: Employee, items: ChecklistSummary[] | 'refused') {
  const asked: URLSearchParams[] = [];
  server.use(
    http.get(`${API}/employees/${employee.id}`, () => HttpResponse.json(employee)),
    http.get(`${API}/employees/${employee.id}/schedule`, () =>
      HttpResponse.json({
        employeeId: employee.id,
        effective: [480, 480, 480, 480, 480, 0, 0],
        isDefault: true,
        items: [],
        canManage: false,
      }),
    ),
    http.get(`${API}/employees/${employee.id}/compensation`, () =>
      HttpResponse.json({ employeeId: employee.id, items: [], canManage: false }),
    ),
    http.get(`${API}/checklists`, ({ request }) => {
      asked.push(new URL(request.url).searchParams);
      if (items === 'refused') return errorResponse('FORBIDDEN', 403);
      return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 25 });
    }),
  );
  return asked;
}

const card = () => screen.findByRole('list', { name: 'Checklists about Nina New' });

describe('checklists card on the employee profile', () => {
  it('lists the checklists about the person with kind, status, progress and a link', async () => {
    server.use(...signedInHandlers(userWithRole('hr')));
    const asked = serve(person(), [
      summary(),
      summary({
        id: uuid(21),
        kind: 'offboarding',
        name: 'Leaving',
        status: 'done',
        done: 2,
        total: 2,
        anchorDate: '2026-12-31',
      }),
    ]);
    await renderApp(`/employees/${uuid(1)}`);
    const list = await card();
    const links = within(list).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      `/checklists/${uuid(20)}`,
      `/checklists/${uuid(21)}`,
    ]);
    expect(links[0]).toHaveAccessibleName('Open Standard onboarding');
    expect(links[0]).toHaveTextContent('Onboarding');
    expect(links[0]).toHaveTextContent('1 of 4 done');
    expect(links[0]).toHaveTextContent('25 %');
    expect(links[1]).toHaveTextContent('Offboarding');
    expect(links[1]).toHaveTextContent('2 of 2 done');
    // only this person's checklists, of every kind and status
    expect(asked[0]?.get('employeeId')).toBe(uuid(1));
    expect(asked[0]?.get('status')).toBe('all');
    expect(asked[0]?.get('kind')).toBe('all');
  });

  it('shows nothing when there are no checklists', async () => {
    server.use(...signedInHandlers(userWithRole('hr')));
    serve(person(), []);
    await renderApp(`/employees/${uuid(1)}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Nina New' })).toBeInTheDocument();
    expect(await screen.findByText('Working hours')).toBeInTheDocument();
    expect(screen.queryByText('Onboarding and offboarding steps for this person.')).toBeNull();
  });

  it('shows nothing when the API refuses', async () => {
    server.use(...signedInHandlers(userWithRole('hr')));
    serve(person(), 'refused');
    await renderApp(`/employees/${uuid(1)}`);
    expect(await screen.findByText('Working hours')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /Checklists about/ })).toBeNull();
  });

  it('is shown even without the full profile, when the API allows it', async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    serve(person({ profile: null }), [summary()]);
    await renderApp(`/employees/${uuid(1)}`);
    expect(await card()).toBeInTheDocument();
  });

  it('is not requested for an erased person', async () => {
    server.use(...signedInHandlers(userWithRole('hr')));
    const asked = serve(person({ erased: true, status: 'inactive' } as Partial<Employee>), [
      summary(),
    ]);
    await renderApp(`/employees/${uuid(1)}`);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(asked).toEqual([]);
  });

  it.each([
    ['de', 'Checklisten zu Nina New'],
    ['bg', 'Чеклисти за Nina New'],
  ] as const)('is translated (%s)', async (language, label) => {
    await initTestI18n(language);
    server.use(...signedInHandlers(userWithRole('hr')));
    serve(person(), [summary()]);
    await renderApp(`/employees/${uuid(1)}`);
    expect(await screen.findByRole('list', { name: label })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/profileCard\./);
  });
});
