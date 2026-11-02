import type { Employee, ProjectSummary, Task } from '@intime/contracts';
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
const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 5 });

const eva = {
  id: uuid(1),
  firstName: 'Eva',
  lastName: 'Martin',
  jobTitle: 'Designer',
  department: { id: uuid(2), name: 'Product' },
} as Employee;
const website: ProjectSummary = {
  id: uuid(3),
  code: 'WEB',
  name: 'Website relaunch',
  client: null,
  status: 'active',
  priority: 'normal',
  isBillable: true,
  budgetHours: null,
  startDate: '2026-10-01',
  endDate: null,
  lead: null,
  health: null,
  canEdit: false,
  canStaff: false,
};
const task: Task = {
  id: uuid(4),
  key: 'WEB-12',
  number: 12,
  project: { id: uuid(3), code: 'WEB', name: 'Website relaunch' },
  milestone: null,
  title: 'Hero image',
  description: null,
  type: 'functional',
  status: 'done',
  priority: 'normal',
  assignee: null,
  estimateHours: null,
  dueDate: null,
  doneOn: '2026-10-30',
  overdue: false,
  canEdit: false,
  canMove: false,
};

/** Answers the three searches and records what was asked. */
function serveSearch(o: { people?: Employee[]; projects?: ProjectSummary[]; tasks?: Task[] } = {}) {
  const asked: URL[] = [];
  const record = (request: Request) => {
    const url = new URL(request.url);
    if (url.searchParams.get('pageSize') === '5') asked.push(url);
    return url;
  };
  server.use(
    http.get(`${API}/employees`, ({ request }) => {
      record(request);
      return HttpResponse.json(page(o.people ?? []));
    }),
    http.get(`${API}/projects`, ({ request }) => {
      record(request);
      return HttpResponse.json(page(o.projects ?? []));
    }),
    http.get(`${API}/tasks`, ({ request }) => {
      record(request);
      return HttpResponse.json(page(o.tasks ?? []));
    }),
  );
  return asked;
}

const dialog = () => screen.getByRole('dialog', { name: 'Search and go' });
const box = () => within(dialog()).getByRole('combobox');
const options = () =>
  within(dialog())
    .getAllByRole('option')
    .map((o) => o.textContent);

describe('command palette', () => {
  it('opens from the header button with actions and pages, and closes with Escape', async () => {
    await renderApp('/');
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Search' });
    await user.click(button);
    expect(box()).toHaveFocus();
    expect(within(dialog()).getByRole('group', { name: 'Actions' })).toBeInTheDocument();
    expect(within(dialog()).getByRole('group', { name: 'Pages' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(button).toHaveFocus();
  });

  it('opens and closes with Ctrl+K and ⌘K', async () => {
    await renderApp('/');
    const user = userEvent.setup();
    await user.keyboard('{Control>}k{/Control}');
    expect(dialog()).toBeInTheDocument();
    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.keyboard('{Meta>}k{/Meta}');
    expect(dialog()).toBeInTheDocument();
  });

  it('finds a page section and goes there with Enter', async () => {
    server.use(...signedInHandlers(userWithRole('manager')));
    await renderApp('/');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.type(box(), 'leave appro');
    expect(options()[0]).toMatch(/^Leave › Approvals/);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Leave' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not repeat a page as its own section', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    serveSearch();
    await renderApp('/');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.type(box(), 'proj');
    const pages = within(dialog()).getByRole('group', { name: 'Pages' });
    expect(within(pages).getByRole('option', { name: /Projects › Clients/ })).toBeInTheDocument();
    expect(within(pages).queryByRole('option', { name: /Projects › Projects/ })).toBeNull();
  });

  it('moves through the options with the arrows and wraps around', async () => {
    await renderApp('/');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const all = within(dialog()).getAllByRole('option');
    expect(all[0]).toHaveAttribute('aria-selected', 'true');
    expect(box()).toHaveAttribute('aria-activedescendant', all[0]!.id);
    await user.keyboard('{ArrowDown}');
    expect(all[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(all[all.length - 1]).toHaveAttribute('aria-selected', 'true');
  });

  it('shows only what the user may use', async () => {
    server.use(...signedInHandlers(userWithPermissions({})));
    const asked = serveSearch();
    await renderApp('/');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(options()).toEqual([
      expect.stringMatching(/^My profile/),
      expect.stringMatching(/^Notification settings/),
      expect.stringMatching(/^Dashboard/),
      expect.stringMatching(/^Waiting for me/),
    ]);
    await user.type(box(), 'eva');
    expect(await within(dialog()).findByText('Nothing found.')).toBeInTheDocument();
    // without the permissions, nobody is asked about people, projects or tasks
    expect(asked).toEqual([]);
  });

  it('searches people, projects and tasks and opens a task by its key', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    const asked = serveSearch({ people: [eva], projects: [website], tasks: [task] });
    await renderApp('/');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.type(box(), 'web');
    const tasks = await within(dialog()).findByRole('group', { name: 'Tasks' });
    expect(within(dialog()).getByRole('group', { name: 'People' })).toHaveTextContent(
      'Eva MartinDesigner · Product',
    );
    expect(within(dialog()).getByRole('group', { name: 'Projects' })).toHaveTextContent(
      'Website relaunch',
    );
    expect(tasks).toHaveTextContent('WEB-12 · Website relaunch');
    expect(asked.map((u) => `${u.pathname}?q=${u.searchParams.get('q')}`)).toEqual(
      expect.arrayContaining([
        '/api/v1/employees?q=web',
        '/api/v1/projects?q=web',
        '/api/v1/tasks?q=web',
      ]),
    );
    await user.click(within(tasks).getByRole('option', { name: /Hero image/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /search/i })).toHaveValue('WEB-12');
    // a finished task is found too: the page shows every status for a searched link
    expect(await within(screen.getByRole('main')).findByText('Hero image')).toBeInTheDocument();
  });

  it('does not ask the server for one letter', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    const asked = serveSearch();
    await renderApp('/');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.type(box(), 'e');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(asked).toEqual([]);
  });

  it('says when results could not be loaded and keeps the pages', async () => {
    server.use(...signedInHandlers(userWithRole('admin')));
    serveSearch();
    server.use(http.get(`${API}/employees`, () => errorResponse('INTERNAL_ERROR', 500)));
    await renderApp('/');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.type(box(), 'employ');
    expect(
      await within(dialog()).findByText('Some results could not be loaded.'),
    ).toBeInTheDocument();
    expect(options()[0]).toMatch(/^Employees/);
  });

  it.each([
    ['de', 'Suchen', 'Suchen und springen'],
    ['bg', 'Търсене', 'Търсене и преход'],
  ] as const)('is translated (%s)', async (language, button, title) => {
    await initTestI18n(language);
    await renderApp('/');
    await userEvent.setup().click(screen.getByRole('button', { name: button }));
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/palette:|actions\.|groups\./);
  });
});
