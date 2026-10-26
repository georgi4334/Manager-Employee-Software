import { Injectable } from '@nestjs/common';
import {
  MAX_COMPETENCIES,
  canMoveCycle,
  finalRating,
  isPartOverdue,
  reviewVisibility,
  type CalibrationRequest,
  type CreateCompetencyRequest,
  type CreateReviewCycleRequest,
  type ManagerReviewRequest,
  type ReopenRequest,
  type ReviewCycle,
  type ReviewCycleList,
  type ReviewCycleStatus,
  type ReviewDetail,
  type ReviewList,
  type ReviewListQuery,
  type ReviewPart,
  type ReviewReader,
  type ReviewSummary,
  type SelfReviewRequest,
  type UpdateCompetencyRequest,
  type UpdateReviewCycleRequest,
} from '@intime/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import { workspaceToday } from '../projects/projects.present.js';
import {
  conflict,
  dateIn,
  dateOut,
  forbidden,
  invalid,
  notFound,
} from '../projects/projects.shared.js';

const PERSON = { id: true, firstName: true, lastName: true } as const;

const CYCLE = {
  id: true,
  name: true,
  periodStart: true,
  periodEnd: true,
  selfDue: true,
  managerDue: true,
  status: true,
  competencies: {
    orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
    select: { id: true, name: true, description: true },
  },
} satisfies Prisma.ReviewCycleSelect;
type CycleRow = Prisma.ReviewCycleGetPayload<{ select: typeof CYCLE }>;

const REVIEW = {
  id: true,
  employeeId: true,
  selfSummary: true,
  selfSubmittedAt: true,
  managerSummary: true,
  overallRating: true,
  managerSubmittedAt: true,
  managerAuthorId: true,
  calibratedRating: true,
  releasedAt: true,
  employee: { select: PERSON },
  managerAuthor: { select: PERSON },
  cycle: { select: CYCLE },
  ratings: { select: { competencyId: true, part: true, score: true, comment: true } },
} satisfies Prisma.ReviewSelect;
type ReviewRow = Prisma.ReviewGetPayload<{ select: typeof REVIEW }>;

/** Performance review cycles and reviews (docs/adr/0023-performance-reviews.md). */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ----- cycles --------------------------------------------------------------------------------

  listCycles(actor: RequestAuth): Promise<ReviewCycleList> {
    return this.db.tx(async (tx) => {
      const manages = Boolean(actor.permissions['review.manage_cycles']);
      let where: Prisma.ReviewCycleWhereInput;
      if (manages) where = {};
      else {
        const visible = await this.visibleReviews(tx, actor);
        where = { status: { not: 'draft' }, reviews: { some: visible } };
      }
      const rows = await tx.reviewCycle.findMany({
        where,
        select: CYCLE,
        orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      });
      return { items: await Promise.all(rows.map((row) => this.presentCycle(tx, manages, row))) };
    });
  }

  getCycle(actor: RequestAuth, id: string): Promise<ReviewCycle> {
    return this.db.tx(async (tx) => this.cycleFor(tx, actor, id));
  }

  createCycle(actor: RequestAuth, body: CreateReviewCycleRequest): Promise<ReviewCycle> {
    return this.db.tx(async (tx) => {
      let copied: { name: string; description: string | null }[] = [];
      if (body.copyFromCycleId) {
        const source = await tx.reviewCycle.findUnique({
          where: { id: body.copyFromCycleId },
          select: {
            competencies: {
              orderBy: [{ position: 'asc' }, { id: 'asc' }],
              select: { name: true, description: true },
            },
          },
        });
        if (!source) throw invalid('copyFromCycleId', 'unknown_cycle', 'This cycle does not exist');
        copied = source.competencies;
      }
      const created = await tx.reviewCycle.create({
        data: {
          name: body.name,
          periodStart: dateIn(body.periodStart),
          periodEnd: dateIn(body.periodEnd),
          selfDue: dateIn(body.selfDue),
          managerDue: dateIn(body.managerDue),
          competencies: { create: copied.map((c, position) => ({ ...c, position })) },
        },
        select: { id: true },
      });
      await this.record(tx, actor, 'review.cycle_created', 'review_cycle', created.id);
      return this.cycleFor(tx, actor, created.id);
    });
  }

  updateCycle(
    actor: RequestAuth,
    id: string,
    body: UpdateReviewCycleRequest,
  ): Promise<ReviewCycle> {
    return this.db.tx(async (tx) => {
      const row = await this.draftCycle(tx, id);
      const next = {
        periodStart: body.periodStart ?? dateOut(row.periodStart),
        periodEnd: body.periodEnd ?? dateOut(row.periodEnd),
        selfDue: body.selfDue ?? dateOut(row.selfDue),
        managerDue: body.managerDue ?? dateOut(row.managerDue),
      };
      if (next.periodEnd < next.periodStart) {
        throw invalid('periodEnd', 'end_before_start', 'The period ends before it starts');
      }
      if (next.managerDue < next.selfDue) {
        throw invalid(
          'managerDue',
          'end_before_start',
          'The manager deadline is before the self deadline',
        );
      }
      await tx.reviewCycle.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          periodStart: dateIn(next.periodStart),
          periodEnd: dateIn(next.periodEnd),
          selfDue: dateIn(next.selfDue),
          managerDue: dateIn(next.managerDue),
        },
      });
      await this.record(
        tx,
        actor,
        'review.cycle_updated',
        'review_cycle',
        id,
        Object.keys(body).sort(),
      );
      return this.cycleFor(tx, actor, id);
    });
  }

  deleteCycle(actor: RequestAuth, id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      await this.draftCycle(tx, id);
      await tx.reviewCycle.delete({ where: { id } });
      await this.record(tx, actor, 'review.cycle_deleted', 'review_cycle', id);
    });
  }

  addCompetency(
    actor: RequestAuth,
    cycleId: string,
    body: CreateCompetencyRequest,
  ): Promise<ReviewCycle> {
    return this.db.tx(async (tx) => {
      await this.draftCycle(tx, cycleId);
      const existing = await tx.reviewCompetency.findMany({
        where: { cycleId },
        select: { name: true, position: true },
      });
      if (existing.length >= MAX_COMPETENCIES) {
        throw invalid('name', 'too_many', 'A cycle holds at most 12 competencies');
      }
      this.assertFreeName(existing, body.name);
      await tx.reviewCompetency.create({
        data: {
          cycleId,
          name: body.name,
          description: body.description ?? null,
          position: existing.reduce((max, c) => Math.max(max, c.position + 1), 0),
        },
      });
      await this.record(tx, actor, 'review.competency_added', 'review_cycle', cycleId);
      return this.cycleFor(tx, actor, cycleId);
    });
  }

  updateCompetency(
    actor: RequestAuth,
    cycleId: string,
    id: string,
    body: UpdateCompetencyRequest,
  ): Promise<ReviewCycle> {
    return this.db.tx(async (tx) => {
      await this.draftCycle(tx, cycleId);
      const all = await tx.reviewCompetency.findMany({
        where: { cycleId },
        select: { id: true, name: true },
      });
      if (!all.some((c) => c.id === id)) throw notFound('Competency');
      if (body.name)
        this.assertFreeName(
          all.filter((c) => c.id !== id),
          body.name,
        );
      await tx.reviewCompetency.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
        },
      });
      await this.record(
        tx,
        actor,
        'review.competency_updated',
        'review_cycle',
        cycleId,
        Object.keys(body).sort(),
      );
      return this.cycleFor(tx, actor, cycleId);
    });
  }

  removeCompetency(actor: RequestAuth, cycleId: string, id: string): Promise<ReviewCycle> {
    return this.db.tx(async (tx) => {
      await this.draftCycle(tx, cycleId);
      const removed = await tx.reviewCompetency.deleteMany({ where: { id, cycleId } });
      if (removed.count === 0) throw notFound('Competency');
      await this.record(tx, actor, 'review.competency_removed', 'review_cycle', cycleId);
      return this.cycleFor(tx, actor, cycleId);
    });
  }

  /** Moves a cycle one step forward: open creates the reviews, close releases them. */
  moveCycle(actor: RequestAuth, id: string, to: ReviewCycleStatus): Promise<ReviewCycle> {
    return this.db.tx(async (tx) => {
      const row = await tx.reviewCycle.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          periodEnd: true,
          _count: { select: { competencies: true } },
        },
      });
      if (!row) throw notFound('Review cycle');
      if (!canMoveCycle(row.status as ReviewCycleStatus, to)) {
        throw conflict('status', `A ${row.status} cycle cannot become ${to}`);
      }
      // Two people moving the same cycle at once must not both create the reviews.
      const claimed = await tx.reviewCycle.updateMany({
        where: { id, status: row.status },
        data: {
          status: to,
          ...(to === 'open' ? { openedAt: new Date() } : {}),
          ...(to === 'closed' ? { closedAt: new Date() } : {}),
        },
      });
      if (claimed.count !== 1) throw conflict('status', 'The cycle changed, try again');

      if (to === 'open') {
        if (row._count.competencies === 0) {
          throw invalid(
            'competencies',
            'no_competencies',
            'Add at least one competency before opening',
          );
        }
        await this.createReviews(tx, id, dateOut(row.periodEnd));
      }
      if (to === 'closed') await this.releaseReviews(tx, id);
      await this.record(tx, actor, 'review.cycle_status', 'review_cycle', id, undefined, {
        status: to,
      });
      return this.cycleFor(tx, actor, id);
    });
  }

  // ----- reviews -------------------------------------------------------------------------------

  list(actor: RequestAuth, query: ReviewListQuery): Promise<ReviewList> {
    return this.db.tx(async (tx) => {
      const me = await this.myEmployee(tx, actor);
      const where = await this.boxWhere(tx, actor, me, query);
      const [rows, total, today] = await Promise.all([
        tx.review.findMany({
          where,
          select: REVIEW,
          orderBy: [
            { cycle: { periodStart: 'desc' } },
            { employee: { lastName: 'asc' } },
            { employee: { firstName: 'asc' } },
            { id: 'asc' },
          ],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.review.count({ where }),
        workspaceToday(tx, this.context),
      ]);
      return {
        items: rows.map((row) => this.summary(actor, me, row, today)),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  get(actor: RequestAuth, id: string): Promise<ReviewDetail> {
    return this.db.tx(async (tx) => {
      const me = await this.myEmployee(tx, actor);
      return this.detail(tx, actor, me, await this.findVisible(tx, actor, id));
    });
  }

  saveSelf(actor: RequestAuth, id: string, body: SelfReviewRequest): Promise<ReviewDetail> {
    return this.db.tx(async (tx) => {
      const { row, me } = await this.writable(tx, actor, id, 'self');
      this.assertCompetencies(row, body.ratings);
      await this.replaceRatings(tx, id, 'self', body.ratings);
      await tx.review.update({ where: { id }, data: { selfSummary: body.summary ?? null } });
      return this.detail(tx, actor, me, await this.findVisible(tx, actor, id));
    });
  }

  submitSelf(actor: RequestAuth, id: string): Promise<ReviewDetail> {
    return this.db.tx(async (tx) => {
      const { row, me } = await this.writable(tx, actor, id, 'self');
      this.assertComplete(row, 'self');
      await tx.review.update({ where: { id }, data: { selfSubmittedAt: new Date() } });
      return this.detail(tx, actor, me, await this.findVisible(tx, actor, id));
    });
  }

  saveManager(actor: RequestAuth, id: string, body: ManagerReviewRequest): Promise<ReviewDetail> {
    return this.db.tx(async (tx) => {
      const { row, me } = await this.writable(tx, actor, id, 'manager');
      this.assertCompetencies(row, body.ratings);
      await this.replaceRatings(tx, id, 'manager', body.ratings);
      await tx.review.update({
        where: { id },
        data: {
          managerSummary: body.summary ?? null,
          ...(body.overallRating !== undefined ? { overallRating: body.overallRating } : {}),
          managerAuthorId: me,
        },
      });
      return this.detail(tx, actor, me, await this.findVisible(tx, actor, id));
    });
  }

  submitManager(actor: RequestAuth, id: string): Promise<ReviewDetail> {
    return this.db.tx(async (tx) => {
      const { row, me } = await this.writable(tx, actor, id, 'manager');
      this.assertComplete(row, 'manager');
      if (row.overallRating === null) {
        throw invalid('overallRating', 'required', 'An overall rating is needed to submit');
      }
      await tx.review.update({
        where: { id },
        data: { managerSubmittedAt: new Date(), managerAuthorId: me },
      });
      return this.detail(tx, actor, me, await this.findVisible(tx, actor, id));
    });
  }

  calibrate(actor: RequestAuth, id: string, body: CalibrationRequest): Promise<ReviewDetail> {
    return this.db.tx(async (tx) => {
      const me = await this.myEmployee(tx, actor);
      const row = await this.lockedVisible(tx, actor, id);
      this.assertNotOwn(row, me);
      if (row.cycle.status !== 'calibration') {
        throw conflict('status', 'Ratings are calibrated while the cycle is in calibration');
      }
      if (!row.managerSubmittedAt)
        throw conflict('submitted', 'The manager review is not submitted');
      await tx.review.update({ where: { id }, data: { calibratedRating: body.rating } });
      await this.record(tx, actor, 'review.calibrated', 'review', id, undefined, {
        cleared: body.rating === null,
      });
      return this.detail(tx, actor, me, await this.findVisible(tx, actor, id));
    });
  }

  reopen(actor: RequestAuth, id: string, body: ReopenRequest): Promise<ReviewDetail> {
    return this.db.tx(async (tx) => {
      const me = await this.myEmployee(tx, actor);
      const row = await this.lockedVisible(tx, actor, id);
      this.assertNotOwn(row, me);
      if (row.cycle.status !== 'open' && row.cycle.status !== 'calibration') {
        throw conflict('status', 'This review can no longer be changed');
      }
      const submitted = body.part === 'self' ? row.selfSubmittedAt : row.managerSubmittedAt;
      if (!submitted) throw conflict('submitted', 'This part is not submitted');
      await tx.review.update({
        where: { id },
        data:
          body.part === 'self'
            ? { selfSubmittedAt: null }
            : { managerSubmittedAt: null, calibratedRating: null },
      });
      await this.record(tx, actor, 'review.reopened', 'review', id, undefined, { part: body.part });
      return this.detail(tx, actor, me, await this.findVisible(tx, actor, id));
    });
  }

  // ----- helpers: cycles -----------------------------------------------------------------------

  private async cycleFor(tx: TenantTx, actor: RequestAuth, id: string): Promise<ReviewCycle> {
    const manages = Boolean(actor.permissions['review.manage_cycles']);
    const row = await tx.reviewCycle.findFirst({
      where: manages
        ? { id }
        : { id, status: { not: 'draft' }, reviews: { some: await this.visibleReviews(tx, actor) } },
      select: CYCLE,
    });
    if (!row) throw notFound('Review cycle');
    return this.presentCycle(tx, manages, row);
  }

  private async presentCycle(tx: TenantTx, manages: boolean, row: CycleRow): Promise<ReviewCycle> {
    let progress: ReviewCycle['progress'] = null;
    if (manages && row.status !== 'draft') {
      const [total, selfSubmitted, managerSubmitted, calibrated, released] = await Promise.all([
        tx.review.count({ where: { cycleId: row.id } }),
        tx.review.count({ where: { cycleId: row.id, selfSubmittedAt: { not: null } } }),
        tx.review.count({ where: { cycleId: row.id, managerSubmittedAt: { not: null } } }),
        tx.review.count({ where: { cycleId: row.id, calibratedRating: { not: null } } }),
        tx.review.count({ where: { cycleId: row.id, releasedAt: { not: null } } }),
      ]);
      progress = { total, selfSubmitted, managerSubmitted, calibrated, released };
    }
    return {
      id: row.id,
      name: row.name,
      periodStart: dateOut(row.periodStart),
      periodEnd: dateOut(row.periodEnd),
      selfDue: dateOut(row.selfDue),
      managerDue: dateOut(row.managerDue),
      status: row.status as ReviewCycleStatus,
      competencies: row.competencies,
      progress,
      canManage: manages,
    };
  }

  private async draftCycle(tx: TenantTx, id: string) {
    const row = await tx.reviewCycle.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        selfDue: true,
        managerDue: true,
      },
    });
    if (!row) throw notFound('Review cycle');
    if (row.status !== 'draft') throw conflict('status', 'Only a draft cycle can be changed');
    return row;
  }

  private assertFreeName(existing: { name: string }[], name: string): void {
    if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw conflict('name', 'This competency exists already');
    }
  }

  private async createReviews(tx: TenantTx, cycleId: string, periodEnd: string): Promise<void> {
    const people = await tx.employee.findMany({
      where: {
        status: 'active',
        OR: [{ hireDate: null }, { hireDate: { lte: dateIn(periodEnd) } }],
      },
      select: { id: true, userId: true },
    });
    await tx.review.createMany({
      data: people.map((p) => ({ cycleId, employeeId: p.id })),
    });
    for (const person of people) {
      if (person.userId) {
        await this.outbox.publish(tx, 'review.cycle_opened', {
          recipientUserId: person.userId,
          cycleId,
        });
      }
    }
  }

  private async releaseReviews(tx: TenantTx, cycleId: string): Promise<void> {
    const releasing = await tx.review.findMany({
      where: { cycleId, managerSubmittedAt: { not: null } },
      select: { id: true, employee: { select: { userId: true } } },
    });
    await tx.review.updateMany({
      where: { cycleId, managerSubmittedAt: { not: null } },
      data: { releasedAt: new Date() },
    });
    for (const r of releasing) {
      if (r.employee.userId) {
        await this.outbox.publish(tx, 'review.released', {
          recipientUserId: r.employee.userId,
          reviewId: r.id,
        });
      }
    }
  }

  // ----- helpers: reviews ----------------------------------------------------------------------

  private async myEmployee(tx: TenantTx, actor: RequestAuth): Promise<string | null> {
    const employee = await tx.employee.findFirst({
      where: { userId: actor.userId },
      select: { id: true },
    });
    return employee?.id ?? null;
  }

  /** Reviews the caller may see: of people in `review.view` scope, in cycles that left the draft. */
  private async visibleReviews(tx: TenantTx, actor: RequestAuth): Promise<Prisma.ReviewWhereInput> {
    const everyone = await tx.employee.findMany({ select: { id: true } });
    const allowed = await this.authz.allowedEmployees(
      actor,
      'review.view',
      everyone.map((e) => e.id),
    );
    return { employeeId: { in: [...allowed] }, cycle: { status: { not: 'draft' } } };
  }

  private async boxWhere(
    tx: TenantTx,
    actor: RequestAuth,
    me: string | null,
    query: ReviewListQuery,
  ): Promise<Prisma.ReviewWhereInput> {
    const cycle = query.cycleId ? { cycleId: query.cycleId } : {};
    const visible = await this.visibleReviews(tx, actor);
    if (query.box === 'mine') {
      if (!me) return { id: { in: [] } };
      return { AND: [visible, cycle, { employeeId: me }] };
    }
    if (query.box === 'all' && actor.permissions['review.view'] !== 'all') {
      throw forbidden('Only HR and administrators list every review');
    }
    // `team` is everybody the caller may see except themself; `all` (scope all only) includes them.
    return {
      AND: [visible, cycle, ...(query.box === 'team' && me ? [{ employeeId: { not: me } }] : [])],
    };
  }

  private async findVisible(tx: TenantTx, actor: RequestAuth, id: string): Promise<ReviewRow> {
    const visible = await this.visibleReviews(tx, actor);
    const row = await tx.review.findFirst({ where: { AND: [{ id }, visible] }, select: REVIEW });
    if (!row) throw notFound('Review');
    return row;
  }

  /** Like findVisible, holding the row so two writers on one review take turns. */
  private async lockedVisible(tx: TenantTx, actor: RequestAuth, id: string): Promise<ReviewRow> {
    await tx.$executeRaw`SELECT 1 FROM review WHERE id = ${id}::uuid FOR UPDATE`;
    return this.findVisible(tx, actor, id);
  }

  private assertNotOwn(row: ReviewRow, me: string | null): void {
    if (me && row.employeeId === me) throw forbidden('Nobody decides on their own review');
  }

  /** A part can be written by its author while the cycle is open and the part is not submitted. */
  private async writable(
    tx: TenantTx,
    actor: RequestAuth,
    id: string,
    part: ReviewPart,
  ): Promise<{ row: ReviewRow; me: string | null }> {
    const me = await this.myEmployee(tx, actor);
    const row = await this.lockedVisible(tx, actor, id);
    if (part === 'self') {
      if (row.employeeId !== me || !actor.permissions['review.write_self']) {
        throw forbidden('Only the employee writes the self-review');
      }
    } else {
      this.assertNotOwn(row, me);
      await this.authz.assert(actor, 'review.write_for_report', {
        ownerEmployeeId: row.employeeId,
      });
    }
    if (row.cycle.status !== 'open') throw conflict('status', 'The cycle is not open for writing');
    const submitted = part === 'self' ? row.selfSubmittedAt : row.managerSubmittedAt;
    if (submitted) throw conflict('submitted', 'This part is submitted');
    return { row, me };
  }

  private assertCompetencies(row: ReviewRow, ratings: { competencyId: string }[]): void {
    const known = new Set(row.cycle.competencies.map((c) => c.id));
    if (ratings.some((r) => !known.has(r.competencyId))) {
      throw invalid(
        'ratings',
        'unknown_competency',
        'A rating names a competency of another cycle',
      );
    }
  }

  private assertComplete(row: ReviewRow, part: ReviewPart): void {
    const rated = new Set(row.ratings.filter((r) => r.part === part).map((r) => r.competencyId));
    if (row.cycle.competencies.some((c) => !rated.has(c.id))) {
      throw invalid('ratings', 'incomplete', 'Every competency needs a score before submitting');
    }
  }

  private async replaceRatings(
    tx: TenantTx,
    reviewId: string,
    part: ReviewPart,
    ratings: { competencyId: string; score: number; comment?: string | undefined }[],
  ): Promise<void> {
    await tx.reviewRating.deleteMany({ where: { reviewId, part } });
    if (ratings.length > 0) {
      await tx.reviewRating.createMany({
        data: ratings.map((r) => ({
          reviewId,
          part,
          competencyId: r.competencyId,
          score: r.score,
          comment: r.comment ?? null,
        })),
      });
    }
  }

  private reader(actor: RequestAuth, me: string | null, row: ReviewRow): ReviewReader {
    if (me && row.employeeId === me) return 'employee';
    return actor.permissions['review.calibrate'] ? 'calibrator' : 'reviewer';
  }

  private visibility(actor: RequestAuth, me: string | null, row: ReviewRow) {
    const reader = this.reader(actor, me, row);
    return {
      reader,
      ...reviewVisibility({
        reader,
        selfSubmitted: row.selfSubmittedAt !== null,
        managerSubmitted: row.managerSubmittedAt !== null,
        released: row.releasedAt !== null,
        isManagerAuthor: Boolean(me) && row.managerAuthorId === me,
      }),
    };
  }

  private summary(
    actor: RequestAuth,
    me: string | null,
    row: ReviewRow,
    today: string,
  ): ReviewSummary {
    const v = this.visibility(actor, me, row);
    const status = row.cycle.status as ReviewCycleStatus;
    const employeeView = v.reader === 'employee';
    const managerKnown =
      !employeeView || (row.releasedAt !== null && row.managerSubmittedAt !== null);
    return {
      id: row.id,
      cycle: { id: row.cycle.id, name: row.cycle.name, status },
      employee: row.employee,
      selfSubmitted: row.selfSubmittedAt !== null,
      managerSubmitted: managerKnown ? row.managerSubmittedAt !== null : null,
      released: row.releasedAt !== null,
      finalRating: v.finalRating ? finalRating(row) : null,
      selfOverdue: isPartOverdue(
        { due: dateOut(row.cycle.selfDue), submitted: row.selfSubmittedAt !== null },
        status,
        today,
      ),
      managerOverdue: employeeView
        ? null
        : isPartOverdue(
            { due: dateOut(row.cycle.managerDue), submitted: row.managerSubmittedAt !== null },
            status,
            today,
          ),
    };
  }

  private async detail(
    tx: TenantTx,
    actor: RequestAuth,
    me: string | null,
    row: ReviewRow,
  ): Promise<ReviewDetail> {
    const today = await workspaceToday(tx, this.context);
    const v = this.visibility(actor, me, row);
    const own = Boolean(me) && row.employeeId === me;
    const status = row.cycle.status as ReviewCycleStatus;
    const ratingsOf = (part: ReviewPart) =>
      row.ratings
        .filter((r) => r.part === part)
        .map((r) => ({ competencyId: r.competencyId, score: r.score, comment: r.comment }));
    const mayWriteForReport =
      !own &&
      (await this.authz.can(actor, 'review.write_for_report', { ownerEmployeeId: row.employeeId }));
    const calibrator = Boolean(actor.permissions['review.calibrate']) && !own;
    return {
      ...this.summary(actor, me, row, today),
      cycleDetail: {
        periodStart: dateOut(row.cycle.periodStart),
        periodEnd: dateOut(row.cycle.periodEnd),
        selfDue: dateOut(row.cycle.selfDue),
        managerDue: dateOut(row.cycle.managerDue),
        competencies: row.cycle.competencies,
      },
      self: v.self
        ? {
            ratings: ratingsOf('self'),
            summary: row.selfSummary,
            submittedAt: row.selfSubmittedAt?.toISOString() ?? null,
          }
        : null,
      manager: v.manager
        ? {
            ratings: ratingsOf('manager'),
            summary: row.managerSummary,
            submittedAt: row.managerSubmittedAt?.toISOString() ?? null,
            overallRating: row.overallRating,
            author: row.managerAuthor,
          }
        : null,
      calibratedRating: v.calibrated ? row.calibratedRating : null,
      canWriteSelf:
        own &&
        Boolean(actor.permissions['review.write_self']) &&
        status === 'open' &&
        !row.selfSubmittedAt,
      canWriteManager: mayWriteForReport && status === 'open' && !row.managerSubmittedAt,
      canCalibrate: calibrator && status === 'calibration' && row.managerSubmittedAt !== null,
      canReopen:
        calibrator &&
        (status === 'open' || status === 'calibration') &&
        (row.selfSubmittedAt !== null || row.managerSubmittedAt !== null),
    };
  }

  private record(
    tx: TenantTx,
    actor: RequestAuth,
    action: string,
    entity: string,
    entityId: string,
    fields?: string[],
    extra?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(tx, {
      actorUserId: actor.userId,
      action,
      entity,
      entityId,
      ...(fields || extra ? { after: { ...(fields ? { fields } : {}), ...extra } } : {}),
    });
  }
}
