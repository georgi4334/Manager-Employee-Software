import type { PersonSkills, SkillCatalog, SkillPeople } from '@intime/contracts';
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
const REACT = uuid(201);
const DOCKER = uuid(202);
const OLD = uuid(203);

const catalog = (o: Partial<SkillCatalog> = {}): SkillCatalog => ({
  canManage: false,
  categories: [
    {
      id: uuid(101),
      name: 'Languages',
      canDelete: false,
      skills: [
        { id: REACT, name: 'React', description: 'UI library', archived: false, canDelete: false },
        { id: OLD, name: 'Flash', description: null, archived: true, canDelete: false },
      ],
    },
    {
      id: uuid(102),
      name: 'Tools',
      canDelete: false,
      skills: [
        { id: DOCKER, name: 'Docker', description: null, archived: false, canDelete: false },
      ],
    },
  ],
  ...o,
});

const rating = (skillId: string, level: number, o: object = {}) => ({
  skillId,
  level,
  assessedBy: ME,
  selfAssessed: true,
  assessedAt: '2026-10-20T10:00:00Z',
  ...o,
});
const person = (o: Partial<PersonSkills> = {}): PersonSkills => ({
  employee: ME,
  ratings: [],
  canEdit: true,
  ...o,
});

function serve(opts: { cat?: SkillCatalog; mine?: PersonSkills; people?: SkillPeople } = {}) {
  const calls = {
    people: [] as URL[],
    put: [] as unknown[],
    del: [] as string[],
    catalog: [] as { m: string; url: string; body?: unknown }[],
  };
  const mine = opts.mine ?? person();
  server.use(
    http.get(`${API}/employees/me`, () =>
      HttpResponse.json({ id: ME.id, firstName: 'Maria', lastName: 'Mine' }),
    ),
    http.get(`${API}/skills/catalog`, () => HttpResponse.json(opts.cat ?? catalog())),
    http.get(`${API}/skills/employees/:id`, ({ params }) =>
      HttpResponse.json(params.id === ME.id ? mine : person({ employee: DAN })),
    ),
    http.put(`${API}/skills/employees/:id/ratings/:skillId`, async ({ request, params }) => {
      calls.put.push({ skillId: params.skillId, ...((await request.json()) as object) });
      return HttpResponse.json(mine);
    }),
    http.delete(`${API}/skills/employees/:id/ratings/:skillId`, ({ params }) => {
      calls.del.push(String(params.skillId));
      return HttpResponse.json(mine);
    }),
    http.get(`${API}/skills/people`, ({ request }) => {
      calls.people.push(new URL(request.url));
      return HttpResponse.json(
        opts.people ?? {
          items: [
            { employee: DAN, ratings: [rating(REACT, 4, { selfAssessed: false })], canEdit: true },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
        },
      );
    }),
    http.post(`${API}/skills/categories`, async ({ request }) => {
      calls.catalog.push({ m: 'POST', url: 'categories', body: await request.json() });
      return HttpResponse.json(catalog({ canManage: true }), { status: 201 });
    }),
    http.patch(`${API}/skills/categories/:id`, async ({ request }) => {
      calls.catalog.push({ m: 'PATCH', url: 'category', body: await request.json() });
      return HttpResponse.json(catalog({ canManage: true }));
    }),
    http.delete(`${API}/skills/categories/:id`, ({ params }) => {
      calls.catalog.push({ m: 'DELETE', url: `category ${String(params.id)}` });
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${API}/skills`, async ({ request }) => {
      calls.catalog.push({ m: 'POST', url: 'skill', body: await request.json() });
      return HttpResponse.json(catalog({ canManage: true }), { status: 201 });
    }),
    http.patch(`${API}/skills/:id`, async ({ request, params }) => {
      calls.catalog.push({
        m: 'PATCH',
        url: `skill ${String(params.id)}`,
        body: await request.json(),
      });
      return HttpResponse.json(catalog({ canManage: true }));
    }),
    http.delete(`${API}/skills/:id`, ({ params }) => {
      calls.catalog.push({ m: 'DELETE', url: `skill ${String(params.id)}` });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}
const as = (role: 'employee' | 'manager' | 'hr') =>
  server.use(...signedInHandlers(userWithRole(role)));
const manager = (cat: SkillCatalog = catalog()) =>
  catalog({
    canManage: true,
    categories: cat.categories.map((c) => ({
      ...c,
      canDelete: c.skills.length === 0,
      skills: c.skills.map((s) => ({ ...s, canDelete: s.id === DOCKER })),
    })),
  });

describe('access and structure', () => {
  it('is not for people without the permission', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    await renderApp('/skills');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('shows the catalog tab to catalog managers only', async () => {
    as('employee');
    serve();
    const { unmount } = await renderApp('/skills');
    await screen.findByRole('heading', { name: 'Skills' });
    const tabs = within(screen.getByRole('group', { name: 'Show skills' }));
    await waitFor(() =>
      expect(tabs.getAllByRole('button').map((b) => b.textContent)).toEqual([
        'My skills',
        'People',
      ]),
    );
    unmount();
    as('hr');
    serve({ cat: manager() });
    await renderApp('/skills');
    const hrTabs = within(await screen.findByRole('group', { name: 'Show skills' }));
    await waitFor(() =>
      expect(hrTabs.getAllByRole('button').map((b) => b.textContent)).toEqual([
        'My skills',
        'People',
        'Catalog',
      ]),
    );
  });

  it('is in German and Bulgarian', async () => {
    as('employee');
    serve();
    await initTestI18n('de');
    const { unmount } = await renderApp('/skills');
    expect(await screen.findByRole('button', { name: 'Meine Skills' })).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/skills');
    expect(await screen.findByRole('button', { name: 'Моите умения' })).toBeInTheDocument();
  });
});

describe('my skills', () => {
  it('shows the catalog by category with my levels and who set them', async () => {
    as('employee');
    serve({
      mine: person({
        ratings: [rating(REACT, 3), rating(DOCKER, 2, { selfAssessed: false, assessedBy: DAN })],
      }),
    });
    await renderApp('/skills');
    expect(await screen.findByRole('heading', { name: 'Languages' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.getByLabelText('Level of React')).toHaveDisplayValue('3 · Proficient');
    expect(screen.getByLabelText('Level of Docker')).toHaveDisplayValue('2 · Basic');
    expect(screen.getByText(/Rated by you on/)).toBeInTheDocument();
    expect(screen.getByText(/Rated by Dan Dev on/)).toBeInTheDocument();
    expect(screen.getByText('UI library')).toBeInTheDocument();
    // an archived skill nobody rated is not offered
    expect(screen.queryByLabelText('Level of Flash')).not.toBeInTheDocument();
  });

  it('shows an archived skill only where I already have a level, and cannot change it from "not rated"', async () => {
    as('employee');
    serve({ mine: person({ ratings: [rating(OLD, 5)] }) });
    await renderApp('/skills');
    expect(await screen.findByLabelText('Level of Flash')).toHaveDisplayValue('5 · Expert');
    expect(screen.getByText('Flash (archived)')).toBeInTheDocument();
  });

  it('sets and removes a level', async () => {
    as('employee');
    const calls = serve({ mine: person({ ratings: [rating(DOCKER, 2)] }) });
    await renderApp('/skills');
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Level of React'), '4');
    await waitFor(() => expect(calls.put).toEqual([{ skillId: REACT, level: 4 }]));
    await user.selectOptions(screen.getByLabelText('Level of Docker'), '');
    await waitFor(() => expect(calls.del).toEqual([DOCKER]));
  });

  it('cannot be changed when the server says so', async () => {
    as('employee');
    serve({ mine: person({ canEdit: false }) });
    await renderApp('/skills');
    expect(await screen.findByLabelText('Level of React')).toBeDisabled();
  });

  it('says what the server refused', async () => {
    as('employee');
    serve();
    server.use(
      http.put(`${API}/skills/employees/:id/ratings/:skillId`, () =>
        errorResponse('VALIDATION_FAILED', 400, {
          details: [{ path: 'skillId', code: 'skill_archived', message: 'x' }],
        }),
      ),
    );
    await renderApp('/skills');
    await userEvent.setup().selectOptions(await screen.findByLabelText('Level of React'), '2');
    expect(
      await screen.findByText('This skill is archived and can no longer be rated.'),
    ).toBeInTheDocument();
  });

  it('explains an empty catalog', async () => {
    as('employee');
    serve({ cat: catalog({ categories: [] }) });
    await renderApp('/skills');
    expect(await screen.findByText(/There are no skills yet/)).toBeInTheDocument();
  });
});

describe('people', () => {
  it('lists people with their levels and offers editing where allowed', async () => {
    as('manager');
    serve();
    await renderApp('/skills?tab=people');
    const rows = within(await screen.findByRole('list', { name: 'People' })).getAllByRole(
      'listitem',
    );
    expect(rows[0]).toHaveTextContent('Dan Dev');
    expect(rows[0]).toHaveTextContent('React · Advanced (4/5)');
    expect(screen.getByText('1 person')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit the skills of Dan Dev' }));
    expect(await screen.findByLabelText('Level of Docker')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByLabelText('Level of Docker')).not.toBeInTheDocument();
  });

  it('offers no editing when the server says the person cannot be rated', async () => {
    as('manager');
    serve({
      people: {
        items: [{ employee: DAN, ratings: [], canEdit: false }],
        total: 1,
        page: 1,
        pageSize: 25,
      },
    });
    await renderApp('/skills?tab=people');
    expect(await screen.findByText('No skills rated yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit the skills/ })).not.toBeInTheDocument();
  });

  it('passes the filters to the API, and a level only together with a skill', async () => {
    as('hr');
    const calls = serve();
    await renderApp('/skills?tab=people');
    await screen.findByText('Dan Dev');
    const level = screen.getByLabelText('Level');
    expect(level).toBeDisabled();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Skill'), REACT);
    expect(level).toBeEnabled();
    await user.selectOptions(level, '3');
    await user.selectOptions(screen.getByLabelText('Category'), uuid(101));
    await user.type(screen.getByRole('searchbox'), 'dan');
    await waitFor(() => {
      const p = calls.people.at(-1)!.searchParams;
      expect([p.get('skillId'), p.get('minLevel'), p.get('categoryId'), p.get('q')]).toEqual([
        REACT,
        '3',
        uuid(101),
        'dan',
      ]);
    });
    await user.selectOptions(screen.getByLabelText('Skill'), '');
    await waitFor(() => expect(calls.people.at(-1)!.searchParams.get('minLevel')).toBeNull());
  });

  it('says so when nobody matches, and when loading fails', async () => {
    as('hr');
    serve({ people: { items: [], total: 0, page: 1, pageSize: 25 } });
    await renderApp('/skills?tab=people');
    expect(await screen.findByText('Nobody matches.')).toBeInTheDocument();
    server.use(http.get(`${API}/skills/people`, () => errorResponse('INTERNAL_ERROR', 500)));
    await userEvent.setup().selectOptions(screen.getByLabelText('Category'), uuid(102));
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('the catalog', () => {
  it('adds a category and a skill', async () => {
    as('hr');
    const calls = serve({ cat: manager() });
    await renderApp('/skills?tab=catalog');
    const user = userEvent.setup();
    const cat = await screen.findByRole('form', { name: 'New category' });
    await user.click(within(cat).getByRole('button', { name: 'Add category' }));
    expect(await within(cat).findByText('This field is required.')).toBeInTheDocument();
    await user.type(within(cat).getByLabelText('Category name'), ' Methods ');
    await user.click(within(cat).getByRole('button', { name: 'Add category' }));
    await waitFor(() =>
      expect(calls.catalog).toContainEqual({
        m: 'POST',
        url: 'categories',
        body: { name: 'Methods' },
      }),
    );
    const skill = screen.getByRole('form', { name: 'New skill' });
    await user.selectOptions(within(skill).getByLabelText('Category'), uuid(102));
    await user.type(within(skill).getByLabelText('Skill name'), 'Kanban');
    await user.type(within(skill).getByLabelText('Description (optional)'), ' Flow ');
    await user.click(within(skill).getByRole('button', { name: 'Add skill' }));
    await waitFor(() =>
      expect(calls.catalog).toContainEqual({
        m: 'POST',
        url: 'skill',
        body: { categoryId: uuid(102), name: 'Kanban', description: 'Flow' },
      }),
    );
  });

  it('renames a category, archives and restores a skill, and deletes only what may be deleted', async () => {
    as('hr');
    const calls = serve({ cat: manager() });
    await renderApp('/skills?tab=catalog');
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Rename' }))[0]!);
    const form = screen.getByRole('form', { name: 'Rename Languages' });
    await user.clear(within(form).getByLabelText('Category name'));
    await user.type(within(form).getByLabelText('Category name'), 'Programming');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.catalog).toContainEqual({
        m: 'PATCH',
        url: 'category',
        body: { name: 'Programming' },
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Archive React' }));
    await waitFor(() =>
      expect(calls.catalog).toContainEqual({
        m: 'PATCH',
        url: `skill ${REACT}`,
        body: { archived: true },
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Restore Flash' }));
    await waitFor(() =>
      expect(calls.catalog).toContainEqual({
        m: 'PATCH',
        url: `skill ${OLD}`,
        body: { archived: false },
      }),
    );
    // only Docker can be deleted; skills in use and categories with skills have no delete button
    expect(screen.queryByRole('button', { name: 'Delete React' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete category Languages' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete Docker' }));
    await waitFor(() =>
      expect(calls.catalog).toContainEqual({ m: 'DELETE', url: `skill ${DOCKER}` }),
    );
  });

  it('deletes an empty category', async () => {
    as('hr');
    const empty = manager(
      catalog({ categories: [{ id: uuid(103), name: 'Empty', canDelete: true, skills: [] }] }),
    );
    const calls = serve({ cat: empty });
    await renderApp('/skills?tab=catalog');
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Delete category Empty' }));
    await waitFor(() =>
      expect(calls.catalog).toContainEqual({ m: 'DELETE', url: `category ${uuid(103)}` }),
    );
    expect(screen.getByText('No skills in this category.')).toBeInTheDocument();
  });

  it('says what the server refused', async () => {
    as('hr');
    serve({ cat: manager() });
    server.use(
      http.post(`${API}/skills/categories`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'name' } }),
      ),
    );
    await renderApp('/skills?tab=catalog');
    const user = userEvent.setup();
    const cat = await screen.findByRole('form', { name: 'New category' });
    await user.type(within(cat).getByLabelText('Category name'), 'languages');
    await user.click(within(cat).getByRole('button', { name: 'Add category' }));
    expect(await screen.findByText('This name is already in use.')).toBeInTheDocument();
    server.use(
      http.delete(`${API}/skills/:id`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'in_use' } }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Delete Docker' }));
    expect(await screen.findByText(/still in use/)).toBeInTheDocument();
  });

  it('does not show the catalog tab content to people who cannot manage it', async () => {
    as('employee');
    serve();
    await renderApp('/skills?tab=catalog');
    await screen.findByRole('heading', { name: 'Skills' });
    expect(screen.queryByRole('form', { name: 'New category' })).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Level of React')).toBeInTheDocument(); // falls back to My skills
  });
});
