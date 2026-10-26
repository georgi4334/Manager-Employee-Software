import { Injectable } from '@nestjs/common';
import {
  feedbackReportState,
  type CreateFeedbackRequest,
  type FeedbackItem,
  type FeedbackKind,
  type FeedbackList,
  type FeedbackQuery,
  type FeedbackVisibility,
} from '@intime/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import type { TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import { conflict, forbidden, invalid, notFound } from '../projects/projects.shared.js';

const PERSON = { id: true, firstName: true, lastName: true } as const;
const SELECT = {
  id: true,
  fromEmployeeId: true,
  toEmployeeId: true,
  kind: true,
  visibility: true,
  body: true,
  reportedAt: true,
  keptAt: true,
  createdAt: true,
  from: { select: PERSON },
  to: { select: PERSON },
} satisfies Prisma.FeedbackSelect;
type Row = Prisma.FeedbackGetPayload<{ select: typeof SELECT }>;

/** Praise and constructive feedback between colleagues (docs/adr/0021-feedback.md). */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly db: TenantDb,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  list(actor: RequestAuth, query: FeedbackQuery): Promise<FeedbackList> {
    return this.db.tx(async (tx) => {
      const me = await this.me(tx, actor);
      const where = await this.boxWhere(actor, me, query);
      const [rows, total] = await Promise.all([
        tx.feedback.findMany({
          where,
          select: SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.feedback.count({ where }),
      ]);
      return {
        items: rows.map((row) => this.present(actor, me, row)),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  create(actor: RequestAuth, body: CreateFeedbackRequest): Promise<FeedbackItem> {
    return this.db.tx(async (tx) => {
      const me = await this.me(tx, actor);
      if (body.toEmployeeId === me) {
        throw invalid('toEmployeeId', 'self', 'Feedback goes to somebody else');
      }
      const to = await tx.employee.findFirst({
        where: { id: body.toEmployeeId, status: 'active' },
        select: { id: true, userId: true },
      });
      if (!to) {
        throw invalid(
          'toEmployeeId',
          'unknown_employee',
          'This person does not exist or is not active',
        );
      }
      const created = await tx.feedback.create({
        data: {
          fromEmployeeId: me,
          toEmployeeId: to.id,
          kind: body.kind,
          visibility: body.visibility,
          body: body.body,
        },
        select: SELECT,
      });
      if (to.userId) {
        await this.outbox.publish(tx, 'feedback.received', {
          recipientUserId: to.userId,
          feedbackId: created.id,
        });
      }
      return this.present(actor, me, created);
    });
  }

  /** The giver takes it back, or a moderator removes an item that was reported (and is not their own). */
  remove(actor: RequestAuth, id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const me = await this.me(tx, actor);
      const row = await tx.feedback.findUnique({ where: { id }, select: SELECT });
      if (!row) throw notFound('Feedback');
      if (row.fromEmployeeId === me) {
        await tx.feedback.delete({ where: { id } });
        return;
      }
      if (!this.canModerate(actor, me, row)) throw notFound('Feedback');
      await tx.feedback.delete({ where: { id } });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'feedback.removed',
        entity: 'feedback',
        entityId: id,
        after: { kind: row.kind },
      });
    });
  }

  /** The recipient asks a moderator to look at an item, once. */
  report(actor: RequestAuth, id: string): Promise<FeedbackItem> {
    return this.db.tx(async (tx) => {
      const me = await this.me(tx, actor);
      const row = await tx.feedback.findFirst({
        where: { id, toEmployeeId: me },
        select: SELECT,
      });
      if (!row) throw notFound('Feedback');
      if (row.reportedAt || row.keptAt)
        throw conflict('report', 'This feedback was reported before');
      const updated = await tx.feedback.update({
        where: { id },
        data: { reportedAt: new Date() },
        select: SELECT,
      });
      return this.present(actor, me, updated);
    });
  }

  /** A moderator closes a report: the item stays and cannot be reported again. */
  keep(actor: RequestAuth, id: string): Promise<FeedbackItem> {
    return this.db.tx(async (tx) => {
      const me = await this.me(tx, actor);
      if (!actor.permissions['feedback.moderate'])
        throw forbidden('Only moderators decide on reports');
      const row = await tx.feedback.findUnique({ where: { id }, select: SELECT });
      if (!row || !this.canModerate(actor, me, row)) throw notFound('Feedback');
      const updated = await tx.feedback.update({
        where: { id },
        data: { reportedAt: null, keptAt: new Date() },
        select: SELECT,
      });
      return this.present(actor, me, updated);
    });
  }

  // ----- helpers -------------------------------------------------------------------------------

  private async me(tx: TenantTx, actor: RequestAuth): Promise<string> {
    const employee = await tx.employee.findFirst({
      where: { userId: actor.userId, status: 'active' },
      select: { id: true },
    });
    if (!employee) throw forbidden('Only employees give and receive feedback');
    return employee.id;
  }

  private async boxWhere(
    actor: RequestAuth,
    me: string,
    query: FeedbackQuery,
  ): Promise<Prisma.FeedbackWhereInput> {
    if (query.box === 'given') {
      if (!actor.permissions['feedback.give']) throw forbidden('Not allowed to give feedback');
      return { fromEmployeeId: me };
    }
    if (query.box === 'reported') {
      if (!actor.permissions['feedback.moderate']) throw forbidden('Only moderators see reports');
      return {
        reportedAt: { not: null },
        fromEmployeeId: { not: me },
        toEmployeeId: { not: me },
      };
    }
    const target = query.employeeId ?? me;
    if (target === me) {
      if (!actor.permissions['feedback.view_received'])
        throw forbidden('Not allowed to read feedback');
      return { toEmployeeId: me };
    }
    // Somebody else's: only what was shared with their manager, for their manager and HR.
    await this.authz.assert(actor, 'feedback.view_received', { ownerEmployeeId: target });
    return { toEmployeeId: target, visibility: 'recipient_and_manager' };
  }

  /** A moderator may decide on an open report that is not about or by themselves. */
  private canModerate(actor: RequestAuth, me: string, row: Row): boolean {
    return (
      Boolean(actor.permissions['feedback.moderate']) &&
      Boolean(row.reportedAt) &&
      row.fromEmployeeId !== me &&
      row.toEmployeeId !== me
    );
  }

  private present(actor: RequestAuth, me: string, row: Row): FeedbackItem {
    const report = feedbackReportState(row);
    const moderates = this.canModerate(actor, me, row);
    return {
      id: row.id,
      from: row.from,
      to: row.to,
      kind: row.kind as FeedbackKind,
      visibility: row.visibility as FeedbackVisibility,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      report,
      canReport: row.toEmployeeId === me && report === 'none',
      canRemove: row.fromEmployeeId === me || moderates,
      canKeep: moderates,
    };
  }
}
