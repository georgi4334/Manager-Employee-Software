import { AUDIT_ACTIONS, type AuditEntry, type AuditPage } from '@intime/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import auditBg from '@/i18n/locales/bg/audit.json';
import auditDe from '@/i18n/locales/de/audit.json';
import auditEn from '@/i18n/locales/en/audit.json';
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
import { actionTone } from './AuditLogPage';

const uuid = (n: number) => `0192f5a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_USER = uuid(10);
const EVA = uuid(20);

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: uuid(Math.floor(Math.random() * 1e9)),
  at: '2026-11-03T09:15:00Z',
  action: 'employee.updated',
  area: 'people',
  entity: 'employee',
  entityId: EVA,
  actor: { userId: ADMIN_USER, name: 'Ada Admin', employeeId: uuid(11) },
  subject: { name: 'Eva Martin' },
  before: null,
  after: { fields: ['phone', 'jobTitle'] },
  ...over,
});

const ITEMS: AuditEntry[] = [
  entry({ id: uuid(1) }),
  entry({
    id: uuid(2),
    at: '2026-11-02T16:40:00Z',
    action: 'dashboard.updated',
    area: 'workspace',
    entity: 'dashboard_layout',
    entityId: null,
    subject: null,
    after: { widgets: ['tasks'] },
  }),
  entry({
    id: uuid(3),
    at: '2026-11-02T08:00:00Z',
    action: 'privacy.erased',
    area: 'privacy',
    actor: { userId: null, name: null, employeeId: null },
    subject: { name: null },
    after: { reason: 'retention' },
  }),
];

/** Answers the audit log and records each query string. */
function serve(page: Partial<AuditPage> = {}) {
  const asked: URLSearchParams[] = [];
  server.use(
    http.get(`${API}/audit-log`, ({ request }) => {
      asked.push(new URL(request.url).searchParams);
      return HttpResponse.json({
        items: ITEMS,
        total: ITEMS.length,
        page: 1,
        pageSize: 50,
        areas: ['workspace', 'people', 'privacy'],
        ...page,
      } satisfies AuditPage);
    }),
  );
  return asked;
}

const main = () => screen.getByRole('main');

describe('actionTone', () => {
  it.each([
    ['employee.created', 'added'],
    ['compensation.set', 'added'],
    ['employee.schedule_set', 'added'],
    ['review.cycle_opened', 'added'],
    ['dashboard.reset', 'changed'],
    ['review.reopened', 'changed'],
    ['timesheet.reopened', 'changed'],
    ['user.disabled', 'removed'],
    ['user.enabled', 'added'],
    ['employee.reactivated', 'added'],
    ['employee.deactivated', 'removed'],
    ['ai.key_removed', 'removed'],
    ['org.team_members_changed', 'changed'],
  ])('%s is %s', (action, tone) => {
    expect(actionTone(action)).toBe(tone);
  });
});

describe('audit log page', () => {
  it('lists entries by day with who did what and about whom', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    serve();
    await renderApp('/audit-log');
    expect(await screen.findByRole('heading', { level: 1, name: 'Audit log' })).toBeInTheDocument();
    const days = await within(main()).findAllByRole('heading', { level: 2 });
    expect(days.map((d) => d.textContent)).toEqual([
      'Tuesday, 3 November 2026',
      'Monday, 2 November 2026',
    ]);
    expect(within(main()).getByText('Employee details changed')).toBeInTheDocument();
    const first = within(main()).getByRole('article', { name: 'Employee details changed' });
    expect(first).toHaveTextContent('Ada Admin');
    expect(first).toHaveTextContent('About Eva Martin');
    expect(first).toHaveTextContent('People and organization');
    expect(first).toHaveTextContent('09:15');
    // the system and an erased person have no names and no links
    expect(within(main()).getByText('Personal data erased')).toBeInTheDocument();
    expect(within(main()).getByText('System')).toBeInTheDocument();
    expect(within(main()).getByText('About An erased person')).toBeInTheDocument();
    expect(within(main()).getByText('3 entries')).toBeInTheDocument();
  });

  it('shows the changed fields, the recorded values and the links when opened', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    serve();
    await renderApp('/audit-log');
    const user = userEvent.setup();
    const first = await within(main()).findByRole('article', { name: 'Employee details changed' });
    expect(within(first).getByRole('list', { name: 'Changed fields' })).not.toBeVisible();
    await user.click(within(first).getByText('Recorded data'));
    const fields = within(first).getByRole('list', { name: 'Changed fields' });
    expect(
      within(fields)
        .getAllByRole('listitem')
        .map((i) => i.textContent),
    ).toEqual(['phone', 'jobTitle']);
    expect(within(first).getByRole('link', { name: 'Profile of Ada Admin' })).toHaveAttribute(
      'href',
      `/employees/${uuid(11)}`,
    );
    expect(within(first).getByRole('link', { name: 'Profile of Eva Martin' })).toHaveAttribute(
      'href',
      `/employees/${EVA}`,
    );
    // a plain value is shown as stored, and an erased person has no profile link
    const erased = within(main()).getByRole('article', { name: 'Personal data erased' });
    await user.click(within(erased).getByText('Recorded data'));
    expect(within(erased).getByText('reason')).toBeVisible();
    expect(within(erased).getByText('retention')).toBeVisible();
    expect(within(erased).queryByRole('link', { name: /Profile of/ })).toBeNull();
  });

  it('shows changed field names once when only the before side holds them', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    serve({
      items: [
        entry({
          id: uuid(6),
          action: 'role.updated',
          area: 'roles',
          entity: 'role',
          subject: null,
          before: { fields: ['name'] },
          after: { grants: ['leave.view:all'] },
        }),
      ],
      total: 1,
    });
    await renderApp('/audit-log');
    const user = userEvent.setup();
    const card = await within(main()).findByRole('article', { name: 'Role changed' });
    await user.click(within(card).getByText('Recorded data'));
    expect(within(card).getByRole('list', { name: 'Changed fields' })).toHaveTextContent('name');
    expect(within(card).queryByText('fields')).toBeNull();
    expect(within(card).getByText('grants')).toBeVisible();
  });

  it('shows a value that changed as before and after', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    serve({
      items: [
        entry({
          id: uuid(5),
          action: 'user.disabled',
          area: 'users',
          entity: 'user',
          subject: null,
          before: { status: 'active' },
          after: { status: 'disabled' },
        }),
      ],
      total: 1,
    });
    await renderApp('/audit-log');
    const user = userEvent.setup();
    const card = await within(main()).findByRole('article', { name: 'Account disabled' });
    await user.click(within(card).getByText('Recorded data'));
    const row = within(card).getByText('status').closest('div')!;
    expect(row).toHaveTextContent('Before: active→After: disabled');
  });

  it('filters by area and days through the address and the API', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    const asked = serve();
    await renderApp('/audit-log');
    const user = userEvent.setup();
    const area = await within(main()).findByRole('combobox', { name: 'Area' });
    expect(
      within(area)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All areas', 'Workspace', 'People and organization', 'Data protection']);
    await user.selectOptions(area, 'privacy');
    await waitFor(() => expect(asked.at(-1)?.get('area')).toBe('privacy'));
    await user.type(within(main()).getByLabelText('From'), '2026-11-01');
    await waitFor(() => expect(asked.at(-1)?.get('from')).toBe('2026-11-01'));
    await user.click(within(main()).getByRole('button', { name: 'Clear filters' }));
    // back to the first view (answered from the cache)
    expect(area).toHaveValue('');
    expect(within(main()).getByLabelText('From')).toHaveValue('');
    expect(within(main()).queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('says when the end is before the start and does not ask', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    const asked = serve();
    await renderApp('/audit-log?from=2026-11-05&to=2026-11-01');
    expect(
      await within(main()).findByText('The end date is before the start date.'),
    ).toBeInTheDocument();
    expect(asked).toEqual([]);
  });

  it('shows the history of one record and the changes of one person', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    const asked = serve();
    await renderApp('/audit-log');
    const user = userEvent.setup();
    const [first] = await within(main()).findAllByText('Recorded data');
    await user.click(first!);
    const item = first!.closest('li')!;
    await user.click(within(item).getByRole('button', { name: 'History of this record' }));
    await waitFor(() => expect(asked.at(-1)?.get('entityId')).toBe(EVA));
    expect(within(main()).getByText('History of one record')).toBeInTheDocument();

    const [again] = within(main()).getAllByText('Recorded data');
    await user.click(again!);
    await user.click(
      within(again!.closest('li')!).getByRole('button', { name: 'More by this person' }),
    );
    await waitFor(() => expect(asked.at(-1)?.get('actorUserId')).toBe(ADMIN_USER));
    expect(within(main()).getByText('Changes by Ada Admin')).toBeInTheDocument();
  });

  it('pages through long logs', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    const asked = serve({ total: 120 });
    await renderApp('/audit-log');
    const user = userEvent.setup();
    expect(await within(main()).findByText('Page 1 of 3')).toBeInTheDocument();
    await user.click(within(main()).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(asked.at(-1)?.get('page')).toBe('2'));
    expect(within(main()).getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('says when nothing was recorded', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    serve({ items: [], total: 0 });
    await renderApp('/audit-log');
    expect(
      await within(main()).findByText('Nothing was recorded for these filters.'),
    ).toBeInTheDocument();
  });

  it('shows an API error with a way to try again', async () => {
    server.use(
      ...signedInHandlers(userWithRole('admin')),
      http.get(`${API}/audit-log`, () => errorResponse('INTERNAL_ERROR', 500)),
    );
    await renderApp('/audit-log');
    expect(await within(main()).findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('is not in the menu and not reachable without the permission', async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    await renderApp('/audit-log');
    expect(
      await screen.findByRole('heading', { level: 1, name: /not allowed|access/i }),
    ).toBeInTheDocument();
    const menu = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(menu).queryByRole('link', { name: 'Audit log' })).toBeNull();
  });

  it('is in the Administration menu with the permission', async () => {
    server.use(...signedInHandlers(userWithPermissions({ 'admin.audit_log.view': 'all' })));
    serve({ items: [], total: 0, areas: [] });
    await renderApp('/');
    const menu = screen.getByRole('navigation', { name: 'Main navigation' });
    const admin = within(menu).getByRole('list', { name: 'Administration' });
    expect(within(admin).getByRole('link', { name: 'Audit log' })).toHaveAttribute(
      'href',
      '/audit-log',
    );
  });

  it('has a text for every action of the catalog in every language', () => {
    for (const texts of [auditEn, auditDe, auditBg]) {
      const actions = texts.actions as Record<string, Record<string, string>>;
      for (const action of AUDIT_ACTIONS) {
        const [group, verb] = action.split('.') as [string, string];
        expect(actions[group]?.[verb], action).toBeTruthy();
      }
    }
  });

  it.each([
    ['de', 'Protokoll', 'Mitarbeitendendaten geändert'],
    ['bg', 'Одитен дневник', 'Данните на служителя са променени'],
  ] as const)('is translated (%s)', async (language, title, action) => {
    await initTestI18n(language);
    server.use(...signedInHandlers(userWithRole('admin')));
    serve();
    await renderApp('/audit-log');
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(await within(main()).findByText(action)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/audit:|actions\.|areas\./);
  });
});
