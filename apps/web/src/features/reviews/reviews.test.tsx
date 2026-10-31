import type { ReviewCycle, ReviewDetail, ReviewSummary } from '@intime/contracts';
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
const C1 = { id: uuid(301), name: 'Teamwork', description: 'Works with others' };
const C2 = { id: uuid(302), name: 'Delivery', description: null };

const cycle = (o: Partial<ReviewCycle> = {}): ReviewCycle => ({
  id: uuid(200),
  name: 'H2 2026',
  periodStart: '2026-07-01',
  periodEnd: '2026-12-31',
  selfDue: '2027-01-15',
  managerDue: '2027-01-31',
  status: 'open',
  competencies: [C1, C2],
  progress: null,
  canManage: false,
  ...o,
});

const summary = (n: number, o: Partial<ReviewSummary> = {}): ReviewSummary => ({
  id: uuid(500 + n),
  cycle: { id: uuid(200), name: 'H2 2026', status: 'open' },
  employee: ME,
  selfSubmitted: false,
  managerSubmitted: null,
  released: false,
  finalRating: null,
  selfOverdue: false,
  managerOverdue: null,
  ...o,
});

const detail = (n: number, o: Partial<ReviewDetail> = {}): ReviewDetail => ({
  ...summary(n),
  cycleDetail: {
    periodStart: '2026-07-01',
    periodEnd: '2026-12-31',
    selfDue: '2027-01-15',
    managerDue: '2027-01-31',
    competencies: [C1, C2],
  },
  self: null,
  manager: null,
  calibratedRating: null,
  canWriteSelf: false,
  canWriteManager: false,
  canCalibrate: false,
  canReopen: false,
  ...o,
});

const part = (o: object = {}) => ({
  ratings: [
    { competencyId: C1.id, score: 4, comment: 'good' },
    { competencyId: C2.id, score: 3, comment: null },
  ],
  summary: 'My year',
  submittedAt: '2026-12-20T10:00:00Z',
  ...o,
});

function serve(
  opts: { reviews?: ReviewSummary[]; cycles?: ReviewCycle[]; review?: ReviewDetail } = {},
) {
  const calls = {
    list: [] as URL[],
    put: [] as { url: string; body: unknown }[],
    post: [] as { url: string; body?: unknown }[],
    patch: [] as unknown[],
    del: [] as string[],
  };
  const reviews = opts.reviews ?? [];
  server.use(
    http.get(`${API}/reviews/cycles`, () => HttpResponse.json({ items: opts.cycles ?? [cycle()] })),
    http.get(`${API}/reviews`, ({ request }) => {
      calls.list.push(new URL(request.url));
      return HttpResponse.json({ items: reviews, total: reviews.length, page: 1, pageSize: 25 });
    }),
    http.get(`${API}/reviews/:id`, ({ params }) =>
      params.id === opts.review?.id
        ? HttpResponse.json(opts.review)
        : errorResponse('NOT_FOUND', 404),
    ),
    http.put(`${API}/reviews/:id/:part`, async ({ request, params }) => {
      calls.put.push({ url: `${String(params.part)}`, body: await request.json() });
      return HttpResponse.json(opts.review);
    }),
    http.post(`${API}/reviews/:id/:part/submit`, ({ params }) => {
      calls.post.push({ url: `${String(params.part)}/submit` });
      return HttpResponse.json(opts.review);
    }),
    http.put(`${API}/reviews/:id/calibration`, async ({ request }) => {
      calls.put.push({ url: 'calibration', body: await request.json() });
      return HttpResponse.json(opts.review);
    }),
    http.post(`${API}/reviews/:id/reopen`, async ({ request }) => {
      calls.post.push({ url: 'reopen', body: await request.json() });
      return HttpResponse.json(opts.review);
    }),
    http.post(`${API}/reviews/cycles`, async ({ request }) => {
      calls.post.push({ url: 'cycles', body: await request.json() });
      return HttpResponse.json(cycle({ status: 'draft', canManage: true }), { status: 201 });
    }),
    http.post(`${API}/reviews/cycles/:id/competencies`, async ({ request }) => {
      calls.post.push({ url: 'competencies', body: await request.json() });
      return HttpResponse.json(cycle({ status: 'draft', canManage: true }), { status: 201 });
    }),
    http.delete(`${API}/reviews/cycles/:id/competencies/:cid`, ({ params }) => {
      calls.del.push(`competency ${String(params.cid)}`);
      return HttpResponse.json(cycle({ status: 'draft', canManage: true }));
    }),
    http.delete(`${API}/reviews/cycles/:id`, ({ params }) => {
      calls.del.push(`cycle ${String(params.id)}`);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${API}/reviews/cycles/:id/:step`, ({ params }) => {
      calls.post.push({ url: `step ${String(params.step)}` });
      return HttpResponse.json(cycle({ canManage: true }));
    }),
  );
  return calls;
}
const as = (role: 'employee' | 'manager' | 'hr' | 'admin') =>
  server.use(...signedInHandlers(userWithRole(role)));

describe('access and structure', () => {
  it('is not for people without the review permission', async () => {
    server.use(
      ...signedInHandlers(userWithPermissions({ 'notification.manage_own_prefs': 'own' })),
    );
    await renderApp('/reviews');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('shows each role the tabs it may use', async () => {
    for (const [role, tabs] of [
      ['employee', []],
      ['manager', ['My reviews', 'Team']],
      ['hr', ['My reviews', 'Team', 'All reviews', 'Cycles']],
    ] as const) {
      as(role);
      serve({ reviews: [summary(1)] });
      const { unmount } = await renderApp('/reviews');
      await screen.findByRole('heading', { name: 'Performance reviews' });
      await waitFor(() => {
        const group = screen.queryByRole('group', { name: 'Show reviews' });
        const names = group
          ? within(group)
              .getAllByRole('button')
              .map((b) => b.textContent)
          : [];
        expect(names, role).toEqual([...tabs]);
      });
      unmount();
    }
  });

  it('is in German and Bulgarian', async () => {
    as('employee');
    serve({ reviews: [summary(1)] });
    await initTestI18n('de');
    const { unmount } = await renderApp('/reviews');
    expect(
      await screen.findByRole('heading', { name: 'Leistungsbeurteilungen' }),
    ).toBeInTheDocument();
    unmount();
    await initTestI18n('bg');
    await renderApp('/reviews');
    expect(
      await screen.findByRole('heading', { name: 'Оценки на представянето' }),
    ).toBeInTheDocument();
  });
});

describe('the lists', () => {
  it('shows my reviews with the state of both parts', async () => {
    as('employee');
    serve({
      reviews: [
        summary(1, { selfOverdue: true }),
        summary(2, {
          cycle: { id: uuid(201), name: 'H1 2026', status: 'closed' },
          selfSubmitted: true,
          managerSubmitted: true,
          released: true,
          finalRating: 4,
        }),
      ],
    });
    await renderApp('/reviews');
    const rows = within(await screen.findByRole('list', { name: 'My reviews' })).getAllByRole(
      'article',
    );
    expect(rows[0]).toHaveTextContent('H2 2026');
    expect(rows[0]).toHaveTextContent('Self-review overdue');
    expect(rows[0]).toHaveTextContent('Manager review not shown yet');
    expect(rows[1]).toHaveTextContent('Closed');
    expect(rows[1]).toHaveTextContent('Self-review submitted');
    expect(rows[1]).toHaveTextContent('Final rating: 4 of 5');
    expect(rows[1]).toHaveTextContent('Exceeds expectations');
    expect(rows[1]).toHaveTextContent('Results released');
    expect(rows[0]).toHaveTextContent('Not released yet');
    expect(rows[0]).toHaveTextContent('No final rating yet');
    // the three steps, in order
    expect(
      within(within(rows[0]!).getByRole('list', { name: 'Progress' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['1Self-review overdue', '2Manager review not shown yet', '3Not released yet']);
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute('href', `/reviews/${uuid(501)}`);
  });

  it('asks for the box and cycle that were chosen', async () => {
    as('hr');
    const calls = serve({
      reviews: [summary(1, { employee: DAN, managerSubmitted: false, managerOverdue: false })],
    });
    await renderApp('/reviews');
    await screen.findByText('H2 2026');
    expect(calls.list.at(-1)?.searchParams.get('box')).toBe('mine');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Team' }));
    await waitFor(() => expect(calls.list.at(-1)?.searchParams.get('box')).toBe('team'));
    await user.click(screen.getByRole('button', { name: 'All reviews' }));
    await waitFor(() => expect(calls.list.at(-1)?.searchParams.get('box')).toBe('all'));
    await user.selectOptions(await screen.findByLabelText('Cycle'), uuid(200));
    await waitFor(() => expect(calls.list.at(-1)?.searchParams.get('cycleId')).toBe(uuid(200)));
    expect(await screen.findByRole('link', { name: 'Dan Dev · H2 2026' })).toBeInTheDocument();
  });

  it('says so when there is nothing', async () => {
    as('employee');
    serve({ reviews: [] });
    await renderApp('/reviews');
    expect(await screen.findByText('You have no reviews yet.')).toBeInTheDocument();
  });

  it('offers to try again when loading fails', async () => {
    as('employee');
    serve({ reviews: [] });
    server.use(http.get(`${API}/reviews`, () => errorResponse('INTERNAL_ERROR', 500)));
    await renderApp('/reviews');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('writing the self-review', () => {
  it('saves a partial draft with only the scored competencies', async () => {
    as('employee');
    const review = detail(1, { canWriteSelf: true });
    const calls = serve({ review });
    await renderApp(`/reviews/${review.id}`);
    const form = await screen.findByRole('form', { name: 'Write your self-review' });
    const user = userEvent.setup();
    await user.selectOptions(within(form).getByLabelText('Score for Teamwork'), '4');
    await user.type(within(form).getByLabelText('Comment on Teamwork (optional)'), ' good ');
    await user.type(within(form).getByLabelText('Summary (optional)'), ' My year ');
    await user.click(within(form).getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(calls.put).toEqual([
        {
          url: 'self',
          body: {
            ratings: [{ competencyId: C1.id, score: 4, comment: 'good' }],
            summary: 'My year',
          },
        },
      ]),
    );
    expect(calls.post).toEqual([]);
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument();
  });

  it('will not submit before every competency has a score', async () => {
    as('employee');
    const review = detail(1, { canWriteSelf: true });
    const calls = serve({ review });
    await renderApp(`/reviews/${review.id}`);
    const form = await screen.findByRole('form', { name: 'Write your self-review' });
    const user = userEvent.setup();
    await user.selectOptions(within(form).getByLabelText('Score for Teamwork'), '3');
    await user.click(within(form).getByRole('button', { name: 'Submit' }));
    expect(
      await within(form).findByText('Give every competency a score before you submit.'),
    ).toBeInTheDocument();
    expect(calls.put).toEqual([]);
    expect(calls.post).toEqual([]);
  });

  it('saves and then submits when everything is scored', async () => {
    as('employee');
    const review = detail(1, { canWriteSelf: true });
    const calls = serve({ review });
    await renderApp(`/reviews/${review.id}`);
    const form = await screen.findByRole('form', { name: 'Write your self-review' });
    const user = userEvent.setup();
    await user.selectOptions(within(form).getByLabelText('Score for Teamwork'), '3');
    await user.selectOptions(within(form).getByLabelText('Score for Delivery'), '5');
    await user.click(within(form).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(calls.post).toEqual([{ url: 'self/submit' }]));
    expect(calls.put).toHaveLength(1);
    expect(calls.put[0]!.body).toMatchObject({
      ratings: [
        { competencyId: C1.id, score: 3 },
        { competencyId: C2.id, score: 5 },
      ],
    });
  });

  it('continues a saved draft', async () => {
    as('employee');
    const review = detail(1, { canWriteSelf: true, self: part({ submittedAt: null }) });
    serve({ review });
    await renderApp(`/reviews/${review.id}`);
    const form = await screen.findByRole('form', { name: 'Write your self-review' });
    expect(within(form).getByLabelText('Score for Teamwork')).toHaveValue('4');
    expect(within(form).getByLabelText('Comment on Teamwork (optional)')).toHaveValue('good');
    expect(within(form).getByLabelText('Summary (optional)')).toHaveValue('My year');
  });

  it('says what the server refused', async () => {
    as('employee');
    const review = detail(1, { canWriteSelf: true });
    serve({ review });
    server.use(
      http.put(`${API}/reviews/:id/self`, () =>
        errorResponse('CONFLICT', 409, { params: { field: 'submitted' } }),
      ),
    );
    await renderApp(`/reviews/${review.id}`);
    const form = await screen.findByRole('form', { name: 'Write your self-review' });
    await userEvent.setup().click(within(form).getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('This part is already submitted.')).toBeInTheDocument();
  });
});

describe('reading a review', () => {
  it('shows an employee their submitted self-review and that the manager part comes later', async () => {
    as('employee');
    const review = detail(1, { self: part(), selfSubmitted: true });
    serve({ review });
    await renderApp(`/reviews/${review.id}`);
    expect(
      await screen.findByRole('heading', { name: 'Maria Mine · H2 2026' }),
    ).toBeInTheDocument();
    expect(screen.getByText('My year')).toBeInTheDocument();
    expect(screen.getByText('good')).toBeInTheDocument();
    expect(
      screen.getByText('The manager review is shown here once the results are released.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    // each part says where it stands; the header says there is no final rating yet
    expect(screen.getByRole('region', { name: 'Self-review' })).toHaveTextContent(
      /^Self-review\s*Submitted/,
    );
    expect(screen.getByRole('region', { name: 'Manager review' })).toHaveTextContent(
      'Shown after release',
    );
    expect(screen.getByRole('region', { name: 'Maria Mine · H2 2026' })).toHaveTextContent(
      'No final rating yet',
    );
  });

  it('shows a released review with the manager part and the final rating', async () => {
    as('employee');
    const review = detail(1, {
      cycle: { id: uuid(200), name: 'H2 2026', status: 'closed' },
      self: part(),
      selfSubmitted: true,
      managerSubmitted: true,
      released: true,
      finalRating: 5,
      manager: {
        ...part({ summary: 'Strong year' }),
        overallRating: 4,
        author: { id: uuid(60), firstName: 'Mia', lastName: 'Manager' },
      },
    });
    serve({ review });
    await renderApp(`/reviews/${review.id}`);
    expect(await screen.findByText('Strong year')).toBeInTheDocument();
    expect(screen.getByText('Final rating: 5 of 5 (Outstanding)')).toBeInTheDocument();
    expect(screen.getByText('Written by Mia Manager')).toBeInTheDocument();
    expect(screen.getByText('Overall rating: 4 of 5')).toBeInTheDocument();
    const header = screen.getByRole('region', { name: 'Maria Mine · H2 2026' });
    expect(header).toHaveTextContent('Final rating5/5');
    expect(header).toHaveTextContent('Results released');
    expect(screen.getAllByText(/Exceeds expectations/).length).toBeGreaterThan(0); // score words next to the bars
  });

  it('tells a manager the self-review is not submitted yet', async () => {
    as('manager');
    const review = detail(1, { employee: DAN, managerSubmitted: false, canWriteManager: true });
    serve({ review });
    await renderApp(`/reviews/${review.id}`);
    expect(
      await screen.findByText('The self-review has not been submitted yet.'),
    ).toBeInTheDocument();
  });

  it('says so when the review does not exist', async () => {
    as('employee');
    serve({});
    await renderApp(`/reviews/${uuid(1)}`);
    expect(
      await screen.findByText('This review does not exist or you cannot see it.'),
    ).toBeInTheDocument();
  });
});

describe('writing the manager review', () => {
  it('needs an overall rating to submit', async () => {
    as('manager');
    const review = detail(1, {
      employee: DAN,
      managerSubmitted: false,
      canWriteManager: true,
      self: part(),
    });
    const calls = serve({ review });
    await renderApp(`/reviews/${review.id}`);
    const form = await screen.findByRole('form', { name: 'Write the manager review' });
    const user = userEvent.setup();
    await user.selectOptions(within(form).getByLabelText('Score for Teamwork'), '4');
    await user.selectOptions(within(form).getByLabelText('Score for Delivery'), '4');
    await user.click(within(form).getByRole('button', { name: 'Submit' }));
    expect(
      await within(form).findByText('An overall rating is needed to submit.'),
    ).toBeInTheDocument();
    expect(calls.put).toEqual([]);
    await user.selectOptions(within(form).getByLabelText('Overall rating'), '5');
    await user.click(within(form).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(calls.post).toEqual([{ url: 'manager/submit' }]));
    expect(calls.put[0]).toMatchObject({ url: 'manager', body: { overallRating: 5 } });
    // the self-review of the employee is shown next to it
    expect(screen.getByText('My year')).toBeInTheDocument();
  });
});

describe('calibration and corrections', () => {
  const calibrating = detail(1, {
    employee: DAN,
    cycle: { id: uuid(200), name: 'H2 2026', status: 'calibration' },
    self: part(),
    manager: { ...part({ summary: 'Mgr' }), overallRating: 3, author: null },
    managerSubmitted: true,
    canCalibrate: true,
    canReopen: true,
    calibratedRating: 2,
  });

  it('sets and clears the calibrated rating', async () => {
    as('hr');
    const calls = serve({ review: calibrating });
    await renderApp(`/reviews/${calibrating.id}`);
    const form = await screen.findByRole('form', { name: 'Calibration' });
    expect(within(form).getByLabelText('Calibrated rating')).toHaveValue('2');
    expect(screen.getByText("Manager's overall rating: 3")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(within(form).getByLabelText('Calibrated rating'), '4');
    await user.click(within(form).getByRole('button', { name: 'Save calibration' }));
    await waitFor(() => expect(calls.put).toEqual([{ url: 'calibration', body: { rating: 4 } }]));
    await user.selectOptions(within(form).getByLabelText('Calibrated rating'), '');
    await user.click(within(form).getByRole('button', { name: 'Save calibration' }));
    await waitFor(() =>
      expect(calls.put.at(-1)).toEqual({ url: 'calibration', body: { rating: null } }),
    );
  });

  it('reopens a submitted part', async () => {
    as('hr');
    const calls = serve({ review: calibrating });
    await renderApp(`/reviews/${calibrating.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Reopen the manager review' }));
    await waitFor(() => expect(calls.post).toEqual([{ url: 'reopen', body: { part: 'manager' } }]));
    await user.click(screen.getByRole('button', { name: 'Reopen the self-review' }));
    await waitFor(() =>
      expect(calls.post.at(-1)).toEqual({ url: 'reopen', body: { part: 'self' } }),
    );
  });

  it('offers neither where the server says it is not possible', async () => {
    as('manager');
    const review = detail(1, {
      employee: DAN,
      self: part(),
      manager: { ...part(), overallRating: 3, author: null },
      calibratedRating: null,
    });
    serve({ review });
    await renderApp(`/reviews/${review.id}`);
    await screen.findByText('Overall rating: 3 of 5');
    expect(screen.queryByRole('form', { name: 'Calibration' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reopen/ })).not.toBeInTheDocument();
  });
});

describe('managing cycles', () => {
  it('creates a cycle and checks the dates first', async () => {
    as('hr');
    const calls = serve({ cycles: [] });
    await renderApp('/reviews?tab=cycles');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New cycle' }));
    const form = screen.getByRole('form', { name: 'New review cycle' });
    await user.click(within(form).getByRole('button', { name: 'Create' }));
    expect((await within(form).findAllByText('This field is required.')).length).toBe(5);
    await user.type(within(form).getByLabelText('Name'), ' H2 2026 ');
    await user.type(within(form).getByLabelText('Period starts'), '2026-07-01');
    await user.type(within(form).getByLabelText('Period ends'), '2026-06-30');
    await user.type(within(form).getByLabelText('Self-reviews due'), '2027-01-15');
    await user.type(within(form).getByLabelText('Manager reviews due'), '2027-01-31');
    await user.click(within(form).getByRole('button', { name: 'Create' }));
    expect(
      await within(form).findByText('The end cannot be before the start.'),
    ).toBeInTheDocument();
    expect(calls.post).toEqual([]);
    await user.clear(within(form).getByLabelText('Period ends'));
    await user.type(within(form).getByLabelText('Period ends'), '2026-12-31');
    await user.click(within(form).getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(calls.post).toEqual([
        {
          url: 'cycles',
          body: {
            name: 'H2 2026',
            periodStart: '2026-07-01',
            periodEnd: '2026-12-31',
            selfDue: '2027-01-15',
            managerDue: '2027-01-31',
          },
        },
      ]),
    );
  });

  it('adds and removes competencies of a draft, and deletes it after asking', async () => {
    as('hr');
    const draft = cycle({ status: 'draft', canManage: true });
    const calls = serve({ cycles: [draft] });
    await renderApp('/reviews?tab=cycles');
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'New competency' });
    await user.type(within(form).getByLabelText('Competency'), ' Ownership ');
    await user.click(within(form).getByRole('button', { name: 'Add competency' }));
    await waitFor(() =>
      expect(calls.post).toEqual([{ url: 'competencies', body: { name: 'Ownership' } }]),
    );
    await user.click(screen.getByRole('button', { name: 'Remove Teamwork' }));
    await waitFor(() => expect(calls.del).toEqual([`competency ${C1.id}`]));
    await user.click(screen.getByRole('button', { name: 'Delete H2 2026' }));
    expect(calls.del).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Yes, delete this draft' }));
    await waitFor(() => expect(calls.del.at(-1)).toBe(`cycle ${draft.id}`));
  });

  it.each([
    ['draft', 'Open H2 2026', 'Yes, open it and create a review for everybody', 'step open'],
    [
      'open',
      'Start calibration of H2 2026',
      'Yes, stop writing and start calibration',
      'step calibrate',
    ],
    [
      'calibration',
      'Close H2 2026 and release results',
      'Yes, close it and release the results',
      'step close',
    ],
  ] as const)(
    'moves a %s cycle forward only after asking',
    async (status, button, confirm, expected) => {
      as('hr');
      const calls = serve({
        cycles: [
          cycle({
            status,
            canManage: true,
            progress:
              status === 'draft'
                ? null
                : { total: 6, selfSubmitted: 3, managerSubmitted: 2, calibrated: 1, released: 0 },
          }),
        ],
      });
      await renderApp('/reviews?tab=cycles');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: button }));
      expect(calls.post).toEqual([]);
      await user.click(screen.getByRole('button', { name: confirm }));
      await waitFor(() => expect(calls.post).toEqual([{ url: expected }]));
    },
  );

  it('shows the progress of a running cycle and offers nothing for a closed one', async () => {
    as('hr');
    serve({
      cycles: [
        cycle({
          status: 'open',
          canManage: true,
          progress: { total: 6, selfSubmitted: 3, managerSubmitted: 2, calibrated: 1, released: 0 },
        }),
        cycle({
          id: uuid(201),
          name: 'H1 2026',
          status: 'closed',
          canManage: true,
          progress: { total: 5, selfSubmitted: 5, managerSubmitted: 5, calibrated: 5, released: 5 },
        }),
      ],
    });
    await renderApp('/reviews?tab=cycles');
    expect(
      await screen.findByText(
        '3 of 6 self-reviews and 2 manager reviews submitted; 1 calibrated, 0 released.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Close H1 2026/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete H1 2026' })).not.toBeInTheDocument();
  });

  it('shows the reviews of a cycle in the list of all reviews', async () => {
    as('hr');
    const calls = serve({
      cycles: [
        cycle({
          canManage: true,
          progress: { total: 1, selfSubmitted: 0, managerSubmitted: 0, calibrated: 0, released: 0 },
        }),
      ],
      reviews: [summary(1, { employee: DAN })],
    });
    await renderApp('/reviews?tab=cycles');
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Show the reviews of H2 2026' }));
    await waitFor(() => {
      const p = calls.list.at(-1)!.searchParams;
      expect([p.get('box'), p.get('cycleId')]).toEqual(['all', uuid(200)]);
    });
    expect(screen.getByRole('button', { name: 'All reviews' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('says what the server refused', async () => {
    as('hr');
    serve({ cycles: [cycle({ status: 'draft', canManage: true })] });
    server.use(
      http.post(`${API}/reviews/cycles/:id/:step`, () =>
        errorResponse('VALIDATION_FAILED', 400, {
          details: [{ path: 'competencies', code: 'no_competencies', message: 'x' }],
        }),
      ),
    );
    await renderApp('/reviews?tab=cycles');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Open H2 2026' }));
    await user.click(
      screen.getByRole('button', { name: 'Yes, open it and create a review for everybody' }),
    );
    expect(
      await screen.findByText('Add at least one competency before opening the cycle.'),
    ).toBeInTheDocument();
  });
});
