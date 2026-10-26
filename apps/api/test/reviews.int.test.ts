import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  apiErrorBodySchema,
  employeeSchema,
  personalDataExportSchema,
  reviewCycleListSchema,
  reviewCycleSchema,
  reviewDetailSchema,
  reviewListSchema,
  todayIn,
  type ReviewCycle,
  type SystemRole,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { OutboxWorker } from '../src/modules/notifications/delivery/outbox-worker.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;
const UNKNOWN = '0192f5a0-0000-7000-8000-00000000000a';
const ZONE = 'Europe/Sofia';
const api = '/api/v1';

describe.skipIf(!urls)('performance reviews over HTTP (real database)', () => {
  const env = testEnv({
    DATABASE_URL: urls?.app,
    SYSTEM_DATABASE_URL: urls?.system,
    TRUST_PROXY: 'true',
  });
  let app: NestExpressApplication;
  let system: SystemPrismaService;
  const { workspace, accept } = httpWorkspaceHelpers(() => app);

  type Person = Member & { employeeId: string };
  let acme: Workspace;
  let globex: Workspace;
  let hr: Person; // calibrator, manages cycles
  let mia: Person; // manager of dan and eve
  let ron: Person; // manager without reports
  let dan: Person;
  let eve: Person;
  let gus: Person; // no manager
  let admin: Person;
  const today = todayIn(ZONE);

  async function onboard(
    ws: Workspace,
    name: string,
    role: SystemRole = 'employee',
    extra: object = {},
  ) {
    const email = `${name}@${ws === acme ? 'acme' : 'globex'}.eu`;
    const res = await ws.admin.agent
      .post(`${api}/employees`)
      .send({ firstName: name, lastName: 'Test', employmentType: 'full_time', email, ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const who = await accept(email);
    if (role !== 'employee') {
      const set = await ws.admin.agent
        .put(`${api}/users/${who.id}/roles`)
        .send({ roleIds: [ws.roleIds[role]] });
      expect(set.status).toBe(200);
    }
    return { ...who, employeeId: employeeSchema.parse(res.body).id };
  }
  const assign = async (who: Person, managerId: string | null) => {
    const res = await acme.admin.agent
      .put(`${api}/org/employees/${who.employeeId}/assignment`)
      .send({ managerId, departmentId: null });
    expect(res.status).toBe(204);
  };
  const dates = {
    periodStart: '2026-01-01',
    periodEnd: '2026-06-30',
    selfDue: addDays(today, 14),
    managerDue: addDays(today, 28),
  };
  const newCycle = async (body: object = {}, competencies = ['Teamwork', 'Delivery']) => {
    const res = await hr.agent
      .post(`${api}/reviews/cycles`)
      .send({ name: 'H1 2026', ...dates, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    let cycle = reviewCycleSchema.parse(res.body);
    for (const name of competencies) {
      const add = await hr.agent
        .post(`${api}/reviews/cycles/${cycle.id}/competencies`)
        .send({ name });
      expect(add.status, JSON.stringify(add.body)).toBe(201);
      cycle = reviewCycleSchema.parse(add.body);
    }
    return cycle;
  };
  const move = (who: Member, cycleId: string, step: 'open' | 'calibrate' | 'close') =>
    who.agent.post(`${api}/reviews/cycles/${cycleId}/${step}`);
  const moved = async (cycleId: string, step: 'open' | 'calibrate' | 'close') => {
    const res = await move(hr, cycleId, step);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return reviewCycleSchema.parse(res.body);
  };
  const openCycle = async (body: object = {}) => {
    const cycle = await newCycle(body);
    return moved(cycle.id, 'open');
  };
  const reviewsOf = async (who: Member, query: object = {}) => {
    const res = await who.agent.get(`${api}/reviews`).query({ pageSize: 100, ...query });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return reviewListSchema.parse(res.body);
  };
  const myReview = async (who: Person, cycleId: string) => {
    const found = (await reviewsOf(who, { cycleId, box: 'mine' })).items[0];
    expect(found, `${who.email} in ${cycleId}`).toBeTruthy();
    return found!.id;
  };
  const detail = async (who: Member, id: string) => {
    const res = await who.agent.get(`${api}/reviews/${id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return reviewDetailSchema.parse(res.body);
  };
  const ratingsFor = (cycle: ReviewCycle, score = 4, comment?: string) =>
    cycle.competencies.map((c) => ({ competencyId: c.id, score, ...(comment ? { comment } : {}) }));
  const saveSelf = (who: Member, id: string, body: object) =>
    who.agent.put(`${api}/reviews/${id}/self`).send(body);
  const submitSelf = (who: Member, id: string) =>
    who.agent.post(`${api}/reviews/${id}/self/submit`);
  const saveManager = (who: Member, id: string, body: object) =>
    who.agent.put(`${api}/reviews/${id}/manager`).send(body);
  const submitManager = (who: Member, id: string) =>
    who.agent.post(`${api}/reviews/${id}/manager/submit`);
  const calibrate = (who: Member, id: string, rating: number | null) =>
    who.agent.put(`${api}/reviews/${id}/calibration`).send({ rating });
  const reopen = (who: Member, id: string, part: string) =>
    who.agent.post(`${api}/reviews/${id}/reopen`).send({ part });
  const notesOf = async (who: Member) => {
    // Opening a cycle queues an event for everybody: take as many passes as the queue needs.
    for (let pass = 0; pass < 30; pass += 1) {
      await app.get(OutboxWorker).runOnce();
      if (
        (await system.outboxEvent.count({
          where: { status: { in: ['pending', 'processing'] } },
        })) === 0
      )
        break;
    }
    return (await who.agent.get(`${api}/notifications`).query({ limit: 50 })).body.items as {
      type: string;
      params: Record<string, unknown>;
    }[];
  };
  /** A full run: dan writes and submits, mia writes and submits, up to the point where the cycle is open. */
  const submitBoth = async (cycle: ReviewCycle, person: Person, boss: Person, overall = 4) => {
    const id = await myReview(person, cycle.id);
    expect(
      (await saveSelf(person, id, { ratings: ratingsFor(cycle, 3), summary: 'My year' })).status,
    ).toBe(200);
    expect((await submitSelf(person, id)).status).toBe(200);
    expect(
      (
        await saveManager(boss, id, {
          ratings: ratingsFor(cycle, 4),
          summary: 'Their year',
          overallRating: overall,
        })
      ).status,
    ).toBe(200);
    expect((await submitManager(boss, id)).status).toBe(200);
    return id;
  };

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    await system.tenant.update({ where: { id: acme.tenantId }, data: { defaultTimezone: ZONE } });
    hr = await onboard(acme, 'hrx', 'hr');
    mia = await onboard(acme, 'mia', 'manager');
    ron = await onboard(acme, 'ron', 'manager');
    dan = await onboard(acme, 'dan');
    eve = await onboard(acme, 'eve');
    gus = await onboard(acme, 'gus');
    const adminEmployee = await system.employee.findFirstOrThrow({
      where: { tenantId: acme.tenantId, userId: acme.admin.id },
    });
    admin = { ...acme.admin, employeeId: adminEmployee.id };
    await assign(dan, mia.employeeId);
    await assign(eve, mia.employeeId);
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe('managing cycles', () => {
    it('lets HR and the administrator create a draft cycle, nobody else', async () => {
      const made = reviewCycleSchema.parse(
        (await hr.agent.post(`${api}/reviews/cycles`).send({ name: ' H2 2026 ', ...dates })).body,
      );
      expect(made).toMatchObject({
        name: 'H2 2026',
        status: 'draft',
        competencies: [],
        progress: null,
        canManage: true,
      });
      expect(
        (await admin.agent.post(`${api}/reviews/cycles`).send({ name: 'By admin', ...dates }))
          .status,
      ).toBe(201);
      for (const who of [mia, dan, ron, gus]) {
        const res = await who.agent
          .post(`${api}/reviews/cycles`)
          .send({ name: 'Sneaky', ...dates });
        expect([res.status, errorBody(res).code], who.email).toEqual([403, 'FORBIDDEN']);
      }
    });

    it.each([
      ['no name', { name: ' ' }],
      ['a long name', { name: 'x'.repeat(81) }],
      ['a period that ends before it starts', { periodEnd: '2025-12-31' }],
      ['a manager deadline before the self deadline', { managerDue: addDays(today, 1) }],
      ['a bad date', { selfDue: '1.2.2027' }],
      ['unknown fields', { status: 'open' }],
    ])('refuses a cycle with %s', async (_label, change) => {
      const res = await hr.agent
        .post(`${api}/reviews/cycles`)
        .send({ name: 'x', ...dates, ...change });
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('copies the competencies of an earlier cycle, and refuses an unknown source', async () => {
      const first = await newCycle({}, ['Teamwork', 'Delivery', 'Ownership']);
      const copy = reviewCycleSchema.parse(
        (
          await hr.agent
            .post(`${api}/reviews/cycles`)
            .send({ name: 'Copy', ...dates, copyFromCycleId: first.id })
        ).body,
      );
      expect(copy.competencies.map((c) => c.name)).toEqual(['Teamwork', 'Delivery', 'Ownership']);
      expect(copy.competencies[0]!.id).not.toBe(first.competencies[0]!.id);
      const bad = await hr.agent
        .post(`${api}/reviews/cycles`)
        .send({ name: 'x', ...dates, copyFromCycleId: UNKNOWN });
      expect([bad.status, errorBody(bad).details?.[0]?.code]).toEqual([400, 'unknown_cycle']);
    });

    it('edits the dates and the competencies of a draft', async () => {
      const cycle = await newCycle({}, ['Teamwork']);
      const edited = reviewCycleSchema.parse(
        (
          await hr.agent
            .patch(`${api}/reviews/cycles/${cycle.id}`)
            .send({ name: 'Renamed', selfDue: addDays(today, 5) })
        ).body,
      );
      expect(edited).toMatchObject({ name: 'Renamed', selfDue: addDays(today, 5) });
      const badDates = await hr.agent
        .patch(`${api}/reviews/cycles/${cycle.id}`)
        .send({ selfDue: addDays(today, 40) });
      expect([badDates.status, errorBody(badDates).details?.[0]?.code]).toEqual([
        400,
        'end_before_start',
      ]);
      const id = cycle.competencies[0]!.id;
      const renamed = reviewCycleSchema.parse(
        (
          await hr.agent
            .patch(`${api}/reviews/cycles/${cycle.id}/competencies/${id}`)
            .send({ name: 'Collaboration', description: ' Works well ' })
        ).body,
      );
      expect(renamed.competencies[0]).toMatchObject({
        name: 'Collaboration',
        description: 'Works well',
      });
      const removed = reviewCycleSchema.parse(
        (await hr.agent.delete(`${api}/reviews/cycles/${cycle.id}/competencies/${id}`)).body,
      );
      expect(removed.competencies).toEqual([]);
      for (const res of [
        await hr.agent.delete(`${api}/reviews/cycles/${cycle.id}/competencies/${UNKNOWN}`),
        await hr.agent
          .patch(`${api}/reviews/cycles/${cycle.id}/competencies/${UNKNOWN}`)
          .send({ name: 'x' }),
        await hr.agent.patch(`${api}/reviews/cycles/${UNKNOWN}`).send({ name: 'x' }),
        await hr.agent.delete(`${api}/reviews/cycles/${UNKNOWN}`),
      ]) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
    });

    it('refuses duplicate competency names, more than twelve, and bad input', async () => {
      const cycle = await newCycle({}, ['Teamwork']);
      const dup = await hr.agent
        .post(`${api}/reviews/cycles/${cycle.id}/competencies`)
        .send({ name: 'TEAMWORK' });
      expect([dup.status, errorBody(dup).params?.field]).toEqual([409, 'name']);
      for (let n = 2; n <= 12; n += 1) {
        expect(
          (
            await hr.agent
              .post(`${api}/reviews/cycles/${cycle.id}/competencies`)
              .send({ name: `C${n}` })
          ).status,
        ).toBe(201);
      }
      const many = await hr.agent
        .post(`${api}/reviews/cycles/${cycle.id}/competencies`)
        .send({ name: 'C13' });
      expect([many.status, errorBody(many).details?.[0]?.code]).toEqual([400, 'too_many']);
      for (const body of [
        { name: ' ' },
        { name: 'x'.repeat(61) },
        { name: 'x', description: 'x'.repeat(301) },
        { name: 'x', weight: 3 },
      ]) {
        const res = await hr.agent
          .post(`${api}/reviews/cycles/${cycle.id}/competencies`)
          .send(body);
        expect([res.status, errorBody(res).code], JSON.stringify(body)).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
    });

    it('deletes a draft, and refuses to change a cycle that has opened', async () => {
      const draft = await newCycle();
      expect((await hr.agent.delete(`${api}/reviews/cycles/${draft.id}`)).status).toBe(204);
      expect((await hr.agent.delete(`${api}/reviews/cycles/${draft.id}`)).status).toBe(404);
      const open = await openCycle();
      for (const res of [
        await hr.agent.patch(`${api}/reviews/cycles/${open.id}`).send({ name: 'Late' }),
        await hr.agent.delete(`${api}/reviews/cycles/${open.id}`),
        await hr.agent.post(`${api}/reviews/cycles/${open.id}/competencies`).send({ name: 'Late' }),
        await hr.agent
          .patch(`${api}/reviews/cycles/${open.id}/competencies/${open.competencies[0]!.id}`)
          .send({ name: 'Late' }),
        await hr.agent.delete(
          `${api}/reviews/cycles/${open.id}/competencies/${open.competencies[0]!.id}`,
        ),
      ]) {
        expect([res.status, errorBody(res).params?.field]).toEqual([409, 'status']);
      }
    });

    it('moves a cycle one step forward only', async () => {
      const cycle = await newCycle();
      for (const step of ['calibrate', 'close'] as const) {
        const res = await move(hr, cycle.id, step);
        expect([res.status, errorBody(res).params?.field], step).toEqual([409, 'status']);
      }
      expect((await moved(cycle.id, 'open')).status).toBe('open');
      expect([
        (await move(hr, cycle.id, 'open')).status,
        (await move(hr, cycle.id, 'close')).status,
      ]).toEqual([409, 409]);
      expect((await moved(cycle.id, 'calibrate')).status).toBe('calibration');
      expect((await move(hr, cycle.id, 'calibrate')).status).toBe(409);
      expect((await moved(cycle.id, 'close')).status).toBe('closed');
      expect((await move(hr, cycle.id, 'close')).status).toBe(409);
      expect((await move(hr, UNKNOWN, 'open')).status).toBe(404);
    });

    it('refuses to open a cycle without competencies, and lets only cycle managers move it', async () => {
      const empty = await newCycle({}, []);
      const res = await move(hr, empty.id, 'open');
      expect([res.status, errorBody(res).details?.[0]?.code]).toEqual([400, 'no_competencies']);
      expect(
        reviewCycleSchema.parse((await hr.agent.get(`${api}/reviews/cycles/${empty.id}`)).body)
          .status,
      ).toBe('draft');
      const cycle = await newCycle();
      for (const who of [mia, dan, ron]) {
        const denied = await move(who, cycle.id, 'open');
        expect([denied.status, errorBody(denied).code], who.email).toEqual([403, 'FORBIDDEN']);
      }
    });

    it('hides draft cycles from everybody who does not manage cycles', async () => {
      const draft = await newCycle({ name: 'Secret draft' });
      for (const who of [mia, dan, ron, gus]) {
        const res = await who.agent.get(`${api}/reviews/cycles/${draft.id}`);
        expect([res.status, errorBody(res).code], who.email).toEqual([404, 'NOT_FOUND']);
        const list = reviewCycleListSchema.parse(
          (await who.agent.get(`${api}/reviews/cycles`)).body,
        );
        expect(
          list.items.map((c) => c.id),
          who.email,
        ).not.toContain(draft.id);
      }
      const asHr = reviewCycleListSchema.parse((await hr.agent.get(`${api}/reviews/cycles`)).body);
      expect(asHr.items.map((c) => c.id)).toContain(draft.id);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('opening a cycle', () => {
    it('creates a review for every active employee who had started, and tells them', async () => {
      const late = await onboard(acme, 'late', 'employee', { hireDate: '2099-01-01' });
      await onboard(acme, 'early', 'employee', { hireDate: '2020-01-01' });
      const gone = await onboard(acme, 'gone');
      await hr.agent
        .post(`${api}/employees/${gone.employeeId}/deactivate`)
        .send({ terminationDate: today });
      const cycle = await openCycle();
      const all = await reviewsOf(hr, { cycleId: cycle.id, box: 'all' });
      const names = all.items.map((r) => r.employee.firstName);
      expect(names).toEqual(expect.arrayContaining(['dan', 'eve', 'gus', 'hrx', 'mia', 'ron']));
      expect(names).toContain('early'); // started before the period ended
      expect(names).not.toContain('late'); // starts after the period
      expect(names).not.toContain('gone'); // no longer active
      const asHr = reviewCycleSchema.parse(
        (await hr.agent.get(`${api}/reviews/cycles/${cycle.id}`)).body,
      );
      expect(asHr.progress).toEqual({
        total: all.total,
        selfSubmitted: 0,
        managerSubmitted: 0,
        calibrated: 0,
        released: 0,
      });
      const note = (await notesOf(dan)).find(
        (n) => n.type === 'review.cycle_opened' && n.params.cycleId === cycle.id,
      );
      expect(note?.params).toEqual({ cycleId: cycle.id });
      expect(
        await system.review.count({ where: { cycleId: cycle.id, employeeId: late.employeeId } }),
      ).toBe(0);
    });

    it('shows employees only cycles that have a review for them, without progress figures', async () => {
      const cycle = await openCycle();
      const asDan = reviewCycleSchema.parse(
        (await dan.agent.get(`${api}/reviews/cycles/${cycle.id}`)).body,
      );
      expect(asDan).toMatchObject({ status: 'open', progress: null, canManage: false });
      expect(asDan.competencies.map((c) => c.name)).toEqual(['Teamwork', 'Delivery']);
      const list = reviewCycleListSchema.parse((await dan.agent.get(`${api}/reviews/cycles`)).body);
      expect(list.items.map((c) => c.id)).toContain(cycle.id);
      expect((await globex.admin.agent.get(`${api}/reviews/cycles/${cycle.id}`)).status).toBe(404);
    });

    it('gives a person a review in a cycle only once, even if two people open it at once', async () => {
      const cycle = await newCycle();
      const results = await Promise.all([
        move(hr, cycle.id, 'open'),
        move(admin, cycle.id, 'open'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const counts = await system.review.groupBy({
        by: ['employeeId'],
        where: { cycleId: cycle.id },
        _count: { _all: true },
      });
      expect(counts.every((c) => c._count._all === 1)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('the self-review', () => {
    it('is written by the employee, saved as a draft, and read back', async () => {
      const cycle = await openCycle();
      const id = await myReview(dan, cycle.id);
      const first = reviewDetailSchema.parse(
        (
          await saveSelf(dan, id, {
            ratings: [{ competencyId: cycle.competencies[0]!.id, score: 3, comment: ' fine ' }],
            summary: ' Good year ',
          })
        ).body,
      );
      expect(first.self).toEqual({
        ratings: [{ competencyId: cycle.competencies[0]!.id, score: 3, comment: 'fine' }],
        summary: 'Good year',
        submittedAt: null,
      });
      expect(first).toMatchObject({
        canWriteSelf: true,
        canWriteManager: false,
        selfSubmitted: false,
      });
      // saving again replaces the draft
      const second = reviewDetailSchema.parse(
        (await saveSelf(dan, id, { ratings: ratingsFor(cycle, 5) })).body,
      );
      expect(second.self?.ratings).toHaveLength(2);
      expect(second.self?.summary).toBeNull();
    });

    it('needs every competency to be scored before it can be submitted, and then locks', async () => {
      const cycle = await openCycle();
      const id = await myReview(dan, cycle.id);
      await saveSelf(dan, id, { ratings: [{ competencyId: cycle.competencies[0]!.id, score: 3 }] });
      const early = await submitSelf(dan, id);
      expect([early.status, errorBody(early).details?.[0]?.code]).toEqual([400, 'incomplete']);
      await saveSelf(dan, id, { ratings: ratingsFor(cycle, 4) });
      const done = reviewDetailSchema.parse((await submitSelf(dan, id)).body);
      expect(done).toMatchObject({ selfSubmitted: true, canWriteSelf: false });
      expect(done.self?.submittedAt).toEqual(expect.any(String));
      for (const res of [await saveSelf(dan, id, { ratings: [] }), await submitSelf(dan, id)]) {
        expect([res.status, errorBody(res).params?.field]).toEqual([409, 'submitted']);
      }
    });

    it.each([
      ['a score of 0', { ratings: [{ score: 0 }] }],
      ['a score of 6', { ratings: [{ score: 6 }] }],
      ['a fractional score', { ratings: [{ score: 2.5 }] }],
      ['a long comment', { ratings: [{ score: 3, comment: 'x'.repeat(501) }] }],
      ['a long summary', { ratings: [], summary: 'x'.repeat(2001) }],
      ['an overall rating', { ratings: [], overallRating: 3 }],
      ['two ratings for one competency', { dup: true }],
    ])('refuses %s', async (_label, shape) => {
      const cycle = await openCycle();
      const id = await myReview(dan, cycle.id);
      const c = cycle.competencies[0]!.id;
      const body =
        'dup' in shape
          ? {
              ratings: [
                { competencyId: c, score: 3 },
                { competencyId: c, score: 4 },
              ],
            }
          : {
              ...shape,
              ...(shape.ratings
                ? { ratings: shape.ratings.map((r) => ({ competencyId: c, ...r })) }
                : {}),
            };
      const res = await saveSelf(dan, id, body);
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('refuses a competency of another cycle', async () => {
      const a = await openCycle();
      const b = await openCycle();
      const id = await myReview(dan, a.id);
      const res = await saveSelf(dan, id, {
        ratings: [{ competencyId: b.competencies[0]!.id, score: 3 }],
      });
      expect([res.status, errorBody(res).details?.[0]?.code]).toEqual([400, 'unknown_competency']);
    });

    it('can only be written by the employee on their own review', async () => {
      const cycle = await openCycle();
      const id = await myReview(dan, cycle.id);
      for (const who of [mia, hr, admin]) {
        const res = await saveSelf(who, id, { ratings: [] });
        expect([res.status, errorBody(res).code], who.email).toEqual([403, 'FORBIDDEN']);
        expect((await submitSelf(who, id)).status, who.email).toBe(403);
      }
      for (const who of [eve, ron, gus]) {
        expect((await saveSelf(who, id, { ratings: [] })).status, who.email).toBe(404);
      }
      expect((await saveSelf(dan, UNKNOWN, { ratings: [] })).status).toBe(404);
    });

    it('is kept from the manager and HR until it is submitted', async () => {
      const cycle = await openCycle();
      const id = await myReview(dan, cycle.id);
      await saveSelf(dan, id, { ratings: ratingsFor(cycle, 2), summary: 'Draft thoughts' });
      for (const who of [mia, hr, admin]) {
        const d = await detail(who, id);
        expect(d.self, `${who.email} before submit`).toBeNull();
        expect(JSON.stringify(d)).not.toContain('Draft thoughts');
      }
      await submitSelf(dan, id);
      for (const who of [mia, hr, admin]) {
        expect((await detail(who, id)).self?.summary, `${who.email} after submit`).toBe(
          'Draft thoughts',
        );
      }
    });

    it('is invisible to colleagues, to other managers and to other workspaces', async () => {
      const cycle = await openCycle();
      const id = await myReview(dan, cycle.id);
      for (const who of [eve, ron, gus, globex.admin]) {
        const res = await who.agent.get(`${api}/reviews/${id}`);
        expect([res.status, errorBody(res).code], who.email).toEqual([404, 'NOT_FOUND']);
      }
      expect(
        (await reviewsOf(gus, { cycleId: cycle.id })).items.map((r) => r.employee.firstName),
      ).toEqual(['gus']);
    });

    it('is locked once the cycle is in calibration', async () => {
      const cycle = await openCycle();
      const id = await myReview(dan, cycle.id);
      await moved(cycle.id, 'calibrate');
      const res = await saveSelf(dan, id, { ratings: [] });
      expect([res.status, errorBody(res).params?.field]).toEqual([409, 'status']);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('the manager review', () => {
    it('is written by the manager of the employee, and needs an overall rating to be submitted', async () => {
      const cycle = await openCycle();
      const id = await myReview(dan, cycle.id);
      const draft = reviewDetailSchema.parse(
        (
          await saveManager(mia, id, {
            ratings: ratingsFor(cycle, 4, 'solid'),
            summary: ' Strong ',
          })
        ).body,
      );
      expect(draft.manager).toMatchObject({
        summary: 'Strong',
        overallRating: null,
        author: { id: mia.employeeId },
        submittedAt: null,
      });
      expect(draft).toMatchObject({ canWriteManager: true });
      const noOverall = await submitManager(mia, id);
      expect([noOverall.status, errorBody(noOverall).details?.[0]?.code]).toEqual([
        400,
        'required',
      ]);
      await saveManager(mia, id, { ratings: ratingsFor(cycle, 4), overallRating: 4 });
      const incomplete = await saveManager(mia, id, {
        ratings: [{ competencyId: cycle.competencies[0]!.id, score: 4 }],
        overallRating: 4,
      });
      expect(incomplete.status).toBe(200);
      const missing = await submitManager(mia, id);
      expect([missing.status, errorBody(missing).details?.[0]?.code]).toEqual([400, 'incomplete']);
      await saveManager(mia, id, { ratings: ratingsFor(cycle, 5), overallRating: 5 });
      const done = reviewDetailSchema.parse((await submitManager(mia, id)).body);
      expect(done.manager).toMatchObject({ overallRating: 5, submittedAt: expect.any(String) });
      expect(done.canWriteManager).toBe(false);
      for (const res of [
        await saveManager(mia, id, { ratings: [] }),
        await submitManager(mia, id),
      ]) {
        expect([res.status, errorBody(res).params?.field]).toEqual([409, 'submitted']);
      }
    });

    it('keeps the overall rating when only the texts are saved', async () => {
      const cycle = await openCycle();
      const id = await myReview(eve, cycle.id);
      await saveManager(mia, id, { ratings: [], overallRating: 3 });
      const again = reviewDetailSchema.parse(
        (await saveManager(mia, id, { ratings: ratingsFor(cycle, 3), summary: 'More' })).body,
      );
      expect(again.manager?.overallRating).toBe(3);
      const bad = await saveManager(mia, id, { ratings: [], overallRating: 6 });
      expect(bad.status).toBe(400);
    });

    it('is written only by people with authority over the employee', async () => {
      const cycle = await openCycle();
      const id = await myReview(dan, cycle.id);
      // no permission at all
      for (const who of [dan, eve, gus]) {
        const res = await saveManager(who, id, { ratings: [] });
        expect([res.status, errorBody(res).code], who.email).toEqual([403, 'FORBIDDEN']);
      }
      // a manager outside the line cannot even see the review
      expect((await saveManager(ron, id, { ratings: [] })).status).toBe(404);
      // HR and the administrator may write for anyone
      expect(
        (await saveManager(hr, id, { ratings: ratingsFor(cycle, 3), overallRating: 3 })).status,
      ).toBe(200);
      expect((await saveManager(admin, id, { ratings: ratingsFor(cycle, 4) })).status).toBe(200);
    });

    it('is never written by the person it is about, whatever their role', async () => {
      const cycle = await openCycle();
      for (const who of [hr, mia, admin]) {
        const id = await myReview(who, cycle.id);
        const res = await saveManager(who, id, { ratings: ratingsFor(cycle, 5), overallRating: 5 });
        expect([res.status, errorBody(res).code], who.email).toEqual([403, 'FORBIDDEN']);
        expect((await submitManager(who, id)).status, who.email).toBe(403);
      }
    });

    it('is hidden from the employee, and from others until submitted', async () => {
      const cycle = await openCycle();
      const id = await myReview(dan, cycle.id);
      await saveManager(mia, id, {
        ratings: ratingsFor(cycle, 2),
        summary: 'Manager draft',
        overallRating: 2,
      });
      expect((await detail(dan, id)).manager).toBeNull();
      expect((await detail(mia, id)).manager?.summary).toBe('Manager draft');
      for (const who of [hr, admin]) expect((await detail(who, id)).manager, who.email).toBeNull();
      await submitManager(mia, id);
      for (const who of [hr, admin, mia])
        expect((await detail(who, id)).manager?.summary, who.email).toBe('Manager draft');
      const asDan = await detail(dan, id);
      expect(asDan.manager).toBeNull();
      expect(asDan.managerSubmitted).toBeNull(); // the employee does not even learn that it is done
      expect(asDan.finalRating).toBeNull();
      expect(JSON.stringify(asDan)).not.toContain('Manager draft');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('calibration', () => {
    it('is the work of HR and the administrator, after the cycle moved to calibration', async () => {
      const cycle = await openCycle();
      const id = await submitBoth(cycle, dan, mia, 3);
      const early = await calibrate(hr, id, 5);
      expect([early.status, errorBody(early).params?.field]).toEqual([409, 'status']);
      await moved(cycle.id, 'calibrate');
      for (const who of [mia, dan, eve, ron]) {
        const res = await calibrate(who, id, 5);
        expect([res.status, errorBody(res).code], who.email).toEqual([403, 'FORBIDDEN']);
      }
      const d = reviewDetailSchema.parse((await calibrate(hr, id, 5)).body);
      expect(d).toMatchObject({ calibratedRating: 5, canCalibrate: true });
      expect(reviewDetailSchema.parse((await calibrate(admin, id, 2)).body).calibratedRating).toBe(
        2,
      );
      expect(
        reviewDetailSchema.parse((await calibrate(hr, id, null)).body).calibratedRating,
      ).toBeNull();
      for (const rating of [0, 6, 2.5]) expect((await calibrate(hr, id, rating)).status).toBe(400);
      const progress = reviewCycleSchema.parse(
        (await hr.agent.get(`${api}/reviews/cycles/${cycle.id}`)).body,
      ).progress;
      expect(progress).toMatchObject({ calibrated: 0 });
    });

    it('keeps the calibrated rating from the manager and the employee until release', async () => {
      const cycle = await openCycle();
      const id = await submitBoth(cycle, dan, mia, 3);
      await moved(cycle.id, 'calibrate');
      await calibrate(hr, id, 5);
      expect((await detail(hr, id)).calibratedRating).toBe(5);
      for (const who of [mia, dan]) {
        const d = await detail(who, id);
        expect(d.calibratedRating, who.email).toBeNull();
        expect(d.finalRating, who.email).toBeNull();
        expect(JSON.stringify(d), who.email).not.toMatch(/"calibratedRating":5/);
      }
      expect((await detail(hr, id)).finalRating).toBe(5);
    });

    it('needs a submitted manager review, and is never done on your own review', async () => {
      const cycle = await openCycle();
      const id = await myReview(dan, cycle.id);
      await moved(cycle.id, 'calibrate');
      const res = await calibrate(hr, id, 3);
      expect([res.status, errorBody(res).params?.field]).toEqual([409, 'submitted']);
      const own = await myReview(hr, cycle.id);
      expect((await calibrate(hr, own, 3)).status).toBe(403);
      expect((await reopen(hr, own, 'self')).status).toBe(403);
    });

    it('counts calibrated reviews in the progress of the cycle', async () => {
      const cycle = await openCycle();
      const id = await submitBoth(cycle, eve, mia, 3);
      await moved(cycle.id, 'calibrate');
      await calibrate(hr, id, 4);
      const progress = reviewCycleSchema.parse(
        (await hr.agent.get(`${api}/reviews/cycles/${cycle.id}`)).body,
      ).progress!;
      expect(progress).toMatchObject({
        selfSubmitted: 1,
        managerSubmitted: 1,
        calibrated: 1,
        released: 0,
      });
    });

    it('lets HR reopen a submitted part, which also drops the calibrated rating of a manager review', async () => {
      const cycle = await openCycle();
      const id = await submitBoth(cycle, dan, mia, 3);
      for (const who of [mia, dan, ron]) {
        expect((await reopen(who, id, 'manager')).status, who.email).toBe(403);
      }
      const selfOpen = reviewDetailSchema.parse((await reopen(hr, id, 'self')).body);
      expect(selfOpen.selfSubmitted).toBe(false);
      expect((await reopen(hr, id, 'self')).status).toBe(409); // not submitted any more
      expect((await saveSelf(dan, id, { ratings: ratingsFor(cycle, 5) })).status).toBe(200);
      await submitSelf(dan, id);
      await moved(cycle.id, 'calibrate');
      await calibrate(hr, id, 5);
      const managerOpen = reviewDetailSchema.parse((await reopen(admin, id, 'manager')).body);
      expect(managerOpen).toMatchObject({ calibratedRating: null, managerSubmitted: false });
      const bad = await hr.agent.post(`${api}/reviews/${id}/reopen`).send({ part: 'both' });
      expect(bad.status).toBe(400);
    });

    it('cannot reopen once the cycle is closed', async () => {
      const cycle = await openCycle();
      const id = await submitBoth(cycle, dan, mia);
      await moved(cycle.id, 'calibrate');
      await moved(cycle.id, 'close');
      const res = await reopen(hr, id, 'manager');
      expect([res.status, errorBody(res).params?.field]).toEqual([409, 'status']);
      expect((await calibrate(hr, id, 1)).status).toBe(409);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('releasing the results', () => {
    it('releases the reviews with a submitted manager part, and tells their employees', async () => {
      const cycle = await openCycle();
      const danId = await submitBoth(cycle, dan, mia, 3);
      const eveId = await myReview(eve, cycle.id); // the manager never finished this one
      await saveManager(mia, eveId, { ratings: ratingsFor(cycle, 2), overallRating: 2 });
      await moved(cycle.id, 'calibrate');
      await calibrate(hr, danId, 5);
      const closed = await moved(cycle.id, 'close');
      expect(closed.progress).toMatchObject({ managerSubmitted: 1, released: 1 });

      const released = await detail(dan, danId);
      expect(released).toMatchObject({ released: true, finalRating: 5, managerSubmitted: true });
      expect(released.manager).toMatchObject({
        summary: 'Their year',
        overallRating: 3,
        author: { id: mia.employeeId },
      });
      expect(released.calibratedRating).toBeNull(); // the employee sees the final rating, not the calibration
      const note = (await notesOf(dan)).find(
        (n) => n.type === 'review.released' && n.params.reviewId === danId,
      );
      expect(note?.params).toEqual({ reviewId: danId });

      const unreleased = await detail(eve, eveId);
      expect(unreleased).toMatchObject({
        released: false,
        manager: null,
        finalRating: null,
        managerSubmitted: null,
      });
      expect((await notesOf(eve)).filter((n) => n.type === 'review.released')).toEqual([]);
      expect(JSON.stringify(unreleased)).not.toContain('Strong');
    });

    it('uses the manager’s overall rating when nothing was calibrated', async () => {
      const cycle = await openCycle();
      const id = await submitBoth(cycle, dan, mia, 4);
      await moved(cycle.id, 'calibrate');
      await moved(cycle.id, 'close');
      expect((await detail(dan, id)).finalRating).toBe(4);
      expect((await detail(mia, id)).finalRating).toBe(4);
    });

    it('lets everybody with a view read a released review as before, and nobody write', async () => {
      const cycle = await openCycle();
      const id = await submitBoth(cycle, dan, mia);
      await moved(cycle.id, 'calibrate');
      await moved(cycle.id, 'close');
      expect(reviewDetailSchema.parse(await detail(mia, id)).cycle.status).toBe('closed');
      for (const res of [
        await saveSelf(dan, id, { ratings: [] }),
        await saveManager(mia, id, { ratings: [] }),
      ]) {
        expect([res.status, errorBody(res).params?.field]).toEqual([409, 'status']);
      }
      const d = await detail(dan, id);
      expect([d.canWriteSelf, d.canWriteManager, d.canCalibrate, d.canReopen]).toEqual([
        false,
        false,
        false,
        false,
      ]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('lists and overdue flags', () => {
    it('lists my reviews, my team’s reviews and all reviews, each for who may see them', async () => {
      const cycle = await openCycle();
      const mine = await reviewsOf(dan, { cycleId: cycle.id });
      expect(mine.items.map((r) => r.employee.firstName)).toEqual(['dan']);
      const team = await reviewsOf(mia, { cycleId: cycle.id, box: 'team' });
      expect(team.items.map((r) => r.employee.firstName).sort()).toEqual(['dan', 'eve']);
      expect(
        (await reviewsOf(mia, { cycleId: cycle.id })).items.map((r) => r.employee.firstName),
      ).toEqual(['mia']);
      expect((await reviewsOf(dan, { cycleId: cycle.id, box: 'team' })).items).toEqual([]);
      expect((await reviewsOf(ron, { cycleId: cycle.id, box: 'team' })).items).toEqual([]);
      const all = await reviewsOf(hr, { cycleId: cycle.id, box: 'all' });
      expect(all.total).toBeGreaterThanOrEqual(7);
      expect((await reviewsOf(admin, { cycleId: cycle.id, box: 'all' })).total).toBe(all.total);
      for (const who of [mia, dan, ron]) {
        const res = await who.agent.get(`${api}/reviews`).query({ box: 'all' });
        expect([res.status, errorBody(res).code], who.email).toEqual([403, 'FORBIDDEN']);
      }
      // HR's team box lists everybody except themself
      const hrTeam = await reviewsOf(hr, { cycleId: cycle.id, box: 'team' });
      expect(hrTeam.items.map((r) => r.employee.firstName)).not.toContain('hrx');
    });

    it('pages the list and refuses bad queries', async () => {
      const cycle = await openCycle();
      const page = await reviewsOf(hr, { cycleId: cycle.id, box: 'all', pageSize: 3, page: 2 });
      expect(page.items).toHaveLength(3);
      expect(page.total).toBeGreaterThan(3);
      for (const query of [{ box: 'everyone' }, { cycleId: 'x' }, { pageSize: 101 }, { page: 0 }]) {
        const res = await hr.agent.get(`${api}/reviews`).query(query);
        expect([res.status, errorBody(res).code], JSON.stringify(query)).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
    });

    it('flags unsubmitted parts as overdue after their deadline, only while the cycle is open', async () => {
      const cycle = await openCycle({
        selfDue: addDays(today, -10),
        managerDue: addDays(today, -5),
      });
      const id = await myReview(dan, cycle.id);
      const asDan = (await reviewsOf(dan, { cycleId: cycle.id })).items[0]!;
      expect(asDan).toMatchObject({ selfOverdue: true, managerOverdue: null }); // the employee does not see the manager's state
      const asMia = (await reviewsOf(mia, { cycleId: cycle.id, box: 'team' })).items.find(
        (r) => r.id === id,
      )!;
      expect(asMia).toMatchObject({ selfOverdue: true, managerOverdue: true });
      await submitSelf(dan, id).catch(() => undefined);
      await saveSelf(dan, id, { ratings: ratingsFor(cycle) });
      await submitSelf(dan, id);
      expect((await reviewsOf(dan, { cycleId: cycle.id })).items[0]!.selfOverdue).toBe(false);
      await moved(cycle.id, 'calibrate');
      expect(
        (await reviewsOf(mia, { cycleId: cycle.id, box: 'team' })).items.every(
          (r) => !r.managerOverdue,
        ),
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('audit and privacy', () => {
    it('audits cycle steps, calibrations and reopenings with ids, never ratings or texts', async () => {
      const cycle = await newCycle({ name: 'Audited-Cycle-Name' }, ['Audited-Competency']);
      await moved(cycle.id, 'open');
      const id = await myReview(dan, cycle.id);
      await saveSelf(dan, id, {
        ratings: ratingsFor(cycle, 3, 'Audit-Comment'),
        summary: 'Audit-Summary',
      });
      await submitSelf(dan, id);
      await saveManager(mia, id, {
        ratings: ratingsFor(cycle, 4),
        summary: 'Audit-Manager',
        overallRating: 4,
      });
      await submitManager(mia, id);
      await reopen(hr, id, 'self');
      await moved(cycle.id, 'calibrate');
      await calibrate(hr, id, 5);
      await moved(cycle.id, 'close');
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: { startsWith: 'review.' } },
      });
      expect([...new Set(entries.map((e) => e.action))]).toEqual(
        expect.arrayContaining([
          'review.cycle_created',
          'review.competency_added',
          'review.cycle_status',
          'review.reopened',
          'review.calibrated',
        ]),
      );
      expect(JSON.stringify(entries)).not.toMatch(/Audit-|Audited/);
      expect(
        entries.find((e) => e.action === 'review.calibrated' && e.entityId === id)?.after,
      ).toEqual({ cleared: false });
      expect(
        entries.find((e) => e.action === 'review.reopened' && e.entityId === id)?.after,
      ).toEqual({ part: 'self' });
    });

    it('exports a person’s reviews: their own part always, the manager part only once released', async () => {
      const person = await onboard(acme, 'exporter');
      await assign(person, mia.employeeId);
      const open = await openCycle({ name: 'Exported open' });
      const openId = await myReview(person, open.id);
      await saveSelf(person, openId, {
        ratings: ratingsFor(open, 3, 'my comment'),
        summary: 'my own words',
      });
      await saveManager(mia, openId, {
        ratings: ratingsFor(open, 5),
        summary: 'secret manager words',
        overallRating: 5,
      });
      const doc = personalDataExportSchema.parse(
        (await person.agent.get(`${api}/privacy/export`)).body,
      );
      const entry = doc.reviews.find((r) => r.cycle === 'Exported open')!;
      expect(entry.self).toMatchObject({ summary: 'my own words', submittedAt: null });
      expect(entry.self?.ratings).toEqual([
        { competency: 'Teamwork', score: 3, comment: 'my comment' },
        { competency: 'Delivery', score: 3, comment: 'my comment' },
      ]);
      expect(entry.released).toBeNull();
      expect(JSON.stringify(doc)).not.toContain('secret manager words');

      await submitSelf(person, openId);
      await submitManager(mia, openId);
      await moved(open.id, 'calibrate');
      await calibrate(hr, openId, 4);
      await moved(open.id, 'close');
      const after = personalDataExportSchema.parse(
        (await person.agent.get(`${api}/privacy/export`)).body,
      );
      const released = after.reviews.find((r) => r.cycle === 'Exported open')!.released!;
      expect(released).toMatchObject({ summary: 'secret manager words', finalRating: 4 });
      expect(released.ratings.map((r) => r.score)).toEqual([5, 5]);
    });

    it('erases the reviews about a former employee, and keeps everybody else’s', async () => {
      const leaver = await onboard(acme, 'erasable');
      const cycle = await openCycle({ name: 'Erase cycle' });
      const id = await myReview(leaver, cycle.id);
      await saveSelf(leaver, id, { ratings: ratingsFor(cycle, 2), summary: 'erase me' });
      const keep = await myReview(dan, cycle.id);
      expect(
        (
          await hr.agent
            .post(`${api}/employees/${leaver.employeeId}/deactivate`)
            .send({ terminationDate: today })
        ).status,
      ).toBe(200);
      const erased = await hr.agent
        .post(`${api}/privacy/erase/${leaver.employeeId}`)
        .send({ confirm: true });
      expect(erased.status, JSON.stringify(erased.body)).toBeLessThan(300);
      expect(await system.review.count({ where: { employeeId: leaver.employeeId } })).toBe(0);
      expect(await system.reviewRating.count({ where: { reviewId: id } })).toBe(0);
      expect(await system.review.findUnique({ where: { id: keep } })).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('tenant isolation and database rules', () => {
    it('keeps another workspace away from cycles and reviews, in lists and in every write', async () => {
      const cycle = await openCycle();
      const id = await myReview(dan, cycle.id);
      const x = globex.admin;
      const outsider = await onboard(globex, 'neighbour');
      expect((await reviewsOf(x, { box: 'all' })).items.map((r) => r.id)).not.toContain(id);
      for (const res of [
        await x.agent.get(`${api}/reviews/cycles/${cycle.id}`),
        await x.agent.patch(`${api}/reviews/cycles/${cycle.id}`).send({ name: 'Mine' }),
        await x.agent.delete(`${api}/reviews/cycles/${cycle.id}`),
        await move(x, cycle.id, 'calibrate'),
        await x.agent.post(`${api}/reviews/cycles/${cycle.id}/competencies`).send({ name: 'x' }),
        await x.agent.get(`${api}/reviews/${id}`),
        await calibrate(x, id, 3),
        await reopen(x, id, 'self'),
        await saveManager(x, id, { ratings: [] }),
        await saveSelf(outsider, id, { ratings: [] }),
        await submitSelf(outsider, id),
      ]) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      expect(await system.reviewCycle.findUnique({ where: { id: cycle.id } })).not.toBeNull();
    });

    it('enforces the rules in the database when the application is bypassed', async () => {
      const t = acme.tenantId;
      const cycleBase = {
        tenantId: t,
        name: 'Rules',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-06-30'),
        selfDue: new Date('2026-07-15'),
        managerDue: new Date('2026-07-31'),
      };
      const refuseCycle = (data: object) =>
        expect(
          system.reviewCycle.create({ data: { ...cycleBase, ...data } as never }),
        ).rejects.toThrow();
      await refuseCycle({ status: 'archived' });
      await refuseCycle({ name: '' });
      await refuseCycle({ name: 'x'.repeat(81) });
      await refuseCycle({ periodEnd: new Date('2025-01-01') });
      await refuseCycle({ managerDue: new Date('2026-07-01') });
      const cycle = await system.reviewCycle.create({ data: cycleBase });
      const comp = await system.reviewCompetency.create({
        data: { tenantId: t, cycleId: cycle.id, name: 'C' },
      });
      await expect(
        system.reviewCompetency.create({ data: { tenantId: t, cycleId: cycle.id, name: '' } }),
      ).rejects.toThrow();
      const reviewBase = { tenantId: t, cycleId: cycle.id, employeeId: gus.employeeId };
      const refuseReview = (data: object) =>
        expect(
          system.review.create({ data: { ...reviewBase, ...data } as never }),
        ).rejects.toThrow();
      await refuseReview({ overallRating: 6 });
      await refuseReview({ overallRating: 0 });
      await refuseReview({ calibratedRating: 6 });
      await refuseReview({ selfSummary: 'x'.repeat(2001) });
      await refuseReview({ releasedAt: new Date() }); // released without a submitted manager part
      const review = await system.review.create({ data: reviewBase });
      await expect(system.review.create({ data: reviewBase })).rejects.toThrow(); // one per employee and cycle
      const ratingBase = {
        tenantId: t,
        reviewId: review.id,
        competencyId: comp.id,
        part: 'self',
        score: 3,
      };
      const refuseRating = (data: object) =>
        expect(
          system.reviewRating.create({ data: { ...ratingBase, ...data } as never }),
        ).rejects.toThrow();
      await refuseRating({ score: 0 });
      await refuseRating({ score: 6 });
      await refuseRating({ part: 'peer' });
      await refuseRating({ comment: 'x'.repeat(501) });
      const other = await system.reviewCycle.create({ data: { ...cycleBase, name: 'Other' } });
      const foreign = await system.reviewCompetency.create({
        data: { tenantId: t, cycleId: other.id, name: 'Foreign' },
      });
      await refuseRating({ competencyId: foreign.id }); // a competency of another cycle
      await system.reviewRating.create({ data: ratingBase });
      await refuseRating({}); // the same part twice
    });
  });
});
