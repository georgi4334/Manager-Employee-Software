import { Injectable } from '@nestjs/common';
import {
  MAX_KEY_RESULTS,
  canAlign,
  goalProgress,
  isGoalOverdue,
  keyResultProgress,
  type CreateGoalRequest,
  type CreateKeyResultRequest,
  type GoalCheckInRequest,
  type GoalDetail,
  type GoalList,
  type GoalQuery,
  type GoalScope,
  type GoalStatus,
  type GoalSummary,
  type GoalTeams,
  type KeyResult,
  type UpdateGoalRequest,
  type UpdateKeyResultRequest,
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
  escapeLike,
  forbidden,
  invalid,
  notFound,
} from '../projects/projects.shared.js';

const KR_SELECT = {
  id: true,
  title: true,
  unit: true,
  startValue: true,
  targetValue: true,
  currentValue: true,
  position: true,
} satisfies Prisma.KeyResultSelect;

const SELECT = {
  id: true,
  scope: true,
  ownerEmployeeId: true,
  teamId: true,
  parentGoalId: true,
  title: true,
  description: true,
  status: true,
  dueDate: true,
  progressPct: true,
  owner: { select: { id: true, firstName: true, lastName: true, userId: true } },
  team: { select: { id: true, name: true, leadEmployeeId: true } },
  parent: { select: { id: true, title: true, scope: true } },
  keyResults: {
    select: KR_SELECT,
    orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.GoalSelect;
type Row = Prisma.GoalGetPayload<{ select: typeof SELECT }>;

interface Viewer {
  employeeId: string | null;
  /** Teams the viewer leads or belongs to. */
  teamIds: Set<string>;
  led: Set<string>;
}

const num = (value: Prisma.Decimal | number): number => Number(value);

/** Personal, team and company goals with key results and check-ins (docs/adr/0019-goals.md). */
@Injectable()
export class GoalsService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  list(actor: RequestAuth, query: GoalQuery): Promise<GoalList> {
    return this.db.tx(async (tx) => {
      const viewer = await this.viewer(tx, actor);
      const visible = await this.visibleWhere(tx, actor, viewer);
      const words = (query.q ?? '').split(/\s+/).filter(Boolean).slice(0, 5);
      const where: Prisma.GoalWhereInput = {
        AND: [
          visible,
          query.scope === 'all' ? {} : { scope: query.scope },
          query.status === 'all'
            ? {}
            : query.status === 'open'
              ? { status: { in: ['draft', 'active'] } }
              : { status: query.status },
          query.teamId ? { teamId: query.teamId } : {},
          query.employeeId ? { scope: 'personal', ownerEmployeeId: query.employeeId } : {},
          ...words.map((word) => ({
            title: { contains: escapeLike(word), mode: 'insensitive' as const },
          })),
        ],
      };
      const [rows, total] = await Promise.all([
        tx.goal.findMany({
          where,
          select: SELECT,
          orderBy: [
            { dueDate: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'desc' },
            { id: 'asc' },
          ],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.goal.count({ where }),
      ]);
      const today = await workspaceToday(tx, this.context);
      const items = await Promise.all(rows.map((row) => this.summary(actor, viewer, row, today)));
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  get(actor: RequestAuth, id: string): Promise<GoalDetail> {
    return this.db.tx(async (tx) => {
      const viewer = await this.viewer(tx, actor);
      const row = await this.findVisible(tx, actor, viewer, id);
      return this.detail(tx, actor, viewer, row);
    });
  }

  teams(actor: RequestAuth): Promise<GoalTeams> {
    return this.db.tx(async (tx) => {
      const viewer = await this.viewer(tx, actor);
      const scope = actor.permissions['goal.manage_team'];
      if (!scope) return { items: [] };
      const teams = await tx.team.findMany({
        where: scope === 'all' ? {} : { id: { in: [...viewer.led] } },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      return { items: teams };
    });
  }

  create(actor: RequestAuth, body: CreateGoalRequest): Promise<GoalDetail> {
    return this.db.tx(async (tx) => {
      const viewer = await this.viewer(tx, actor);
      let ownerId = viewer.employeeId;
      let teamId: string | null = null;

      if (body.scope === 'personal') {
        ownerId = body.employeeId ?? viewer.employeeId;
        if (!ownerId) throw forbidden('Only employees have goals');
        const owner = await tx.employee.findFirst({
          where: { id: ownerId, status: 'active' },
          select: { id: true },
        });
        if (!owner)
          throw invalid(
            'employeeId',
            'unknown_employee',
            'This person does not exist or is not active',
          );
        if (!(await this.authz.can(actor, 'goal.manage_personal', { ownerEmployeeId: ownerId }))) {
          throw forbidden('Not allowed to set goals for this person');
        }
      } else if (body.scope === 'team') {
        if (!viewer.employeeId) throw forbidden('Only employees have goals');
        teamId = body.teamId!;
        const team = await tx.team.findUnique({ where: { id: teamId }, select: { id: true } });
        if (!team) throw invalid('teamId', 'unknown_team', 'This team does not exist');
        if (!this.mayManageTeam(actor, viewer, teamId)) {
          throw forbidden('Only the lead of the team, HR or an administrator can set team goals');
        }
      } else {
        if (!viewer.employeeId) throw forbidden('Only employees have goals');
        if (!actor.permissions['goal.manage_company']) {
          throw forbidden('Only HR or an administrator can set company goals');
        }
      }
      if (body.parentGoalId) {
        await this.checkParent(tx, actor, viewer, body.scope, body.parentGoalId);
      }

      const created = await tx.goal.create({
        data: {
          scope: body.scope,
          ownerEmployeeId: ownerId!,
          teamId,
          parentGoalId: body.parentGoalId ?? null,
          title: body.title,
          description: body.description ?? null,
          status: body.status,
          dueDate: body.dueDate ? dateIn(body.dueDate) : null,
          progressPct: body.progressPct,
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'goal.created',
        entity: 'goal',
        entityId: created.id,
        after: { scope: body.scope, teamId },
      });
      if (body.scope === 'personal' && ownerId !== viewer.employeeId) {
        const owner = await tx.employee.findUnique({
          where: { id: ownerId! },
          select: { userId: true },
        });
        if (owner?.userId) {
          await this.outbox.publish(tx, 'goal.assigned', {
            recipientUserId: owner.userId,
            goalId: created.id,
          });
        }
      }
      return this.detail(tx, actor, viewer, await this.find(tx, created.id));
    });
  }

  update(actor: RequestAuth, id: string, body: UpdateGoalRequest): Promise<GoalDetail> {
    return this.db.tx(async (tx) => {
      const viewer = await this.viewer(tx, actor);
      const row = await this.findVisible(tx, actor, viewer, id);
      await this.assertManage(actor, viewer, row);
      if (body.parentGoalId) {
        await this.checkParent(tx, actor, viewer, row.scope as GoalScope, body.parentGoalId);
      }
      await tx.goal.update({
        where: { id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.dueDate !== undefined
            ? { dueDate: body.dueDate ? dateIn(body.dueDate) : null }
            : {}),
          ...(body.parentGoalId !== undefined ? { parentGoalId: body.parentGoalId } : {}),
          ...(body.progressPct !== undefined ? { progressPct: body.progressPct } : {}),
        },
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'goal.updated',
        entity: 'goal',
        entityId: id,
        after: { fields: Object.keys(body).sort() },
      });
      return this.detail(tx, actor, viewer, await this.find(tx, id));
    });
  }

  remove(actor: RequestAuth, id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const viewer = await this.viewer(tx, actor);
      const row = await this.findVisible(tx, actor, viewer, id);
      await this.assertManage(actor, viewer, row);
      if (await tx.goal.findFirst({ where: { parentGoalId: id }, select: { id: true } })) {
        throw conflict('children', 'Goals are aligned to this goal: cancel it instead');
      }
      await tx.goal.delete({ where: { id } });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'goal.deleted',
        entity: 'goal',
        entityId: id,
        after: { scope: row.scope },
      });
    });
  }

  // ----- key results and check-ins -------------------------------------------------------------

  addKeyResult(
    actor: RequestAuth,
    goalId: string,
    body: CreateKeyResultRequest,
  ): Promise<GoalDetail> {
    return this.db.tx(async (tx) => {
      const viewer = await this.viewer(tx, actor);
      const row = await this.findVisible(tx, actor, viewer, goalId);
      await this.assertManage(actor, viewer, row);
      if (row.keyResults.length >= MAX_KEY_RESULTS) {
        throw invalid('title', 'too_many', `A goal has at most ${MAX_KEY_RESULTS} key results`);
      }
      await tx.keyResult.create({
        data: {
          goalId,
          title: body.title,
          unit: body.unit ?? null,
          startValue: body.startValue,
          targetValue: body.targetValue,
          currentValue: body.currentValue ?? body.startValue,
          position: (row.keyResults.at(-1)?.position ?? -1) + 1,
        },
      });
      await this.auditKeyResult(tx, actor, goalId, 'added');
      return this.detail(tx, actor, viewer, await this.find(tx, goalId));
    });
  }

  updateKeyResult(
    actor: RequestAuth,
    goalId: string,
    id: string,
    body: UpdateKeyResultRequest,
  ): Promise<GoalDetail> {
    return this.db.tx(async (tx) => {
      const viewer = await this.viewer(tx, actor);
      const row = await this.findVisible(tx, actor, viewer, goalId);
      await this.assertManage(actor, viewer, row);
      const kr = row.keyResults.find((k) => k.id === id);
      if (!kr) throw notFound('Key result');
      const start = body.startValue ?? num(kr.startValue);
      const target = body.targetValue ?? num(kr.targetValue);
      if (start === target) {
        throw invalid(
          'targetValue',
          'same_as_start',
          'The target must differ from the start value',
        );
      }
      await tx.keyResult.update({
        where: { id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.unit !== undefined ? { unit: body.unit } : {}),
          ...(body.startValue !== undefined ? { startValue: body.startValue } : {}),
          ...(body.targetValue !== undefined ? { targetValue: body.targetValue } : {}),
          ...(body.currentValue !== undefined ? { currentValue: body.currentValue } : {}),
        },
      });
      await this.auditKeyResult(tx, actor, goalId, 'updated');
      return this.detail(tx, actor, viewer, await this.find(tx, goalId));
    });
  }

  removeKeyResult(actor: RequestAuth, goalId: string, id: string): Promise<GoalDetail> {
    return this.db.tx(async (tx) => {
      const viewer = await this.viewer(tx, actor);
      const row = await this.findVisible(tx, actor, viewer, goalId);
      await this.assertManage(actor, viewer, row);
      if (!row.keyResults.some((k) => k.id === id)) throw notFound('Key result');
      await tx.keyResult.delete({ where: { id } });
      await this.auditKeyResult(tx, actor, goalId, 'removed');
      return this.detail(tx, actor, viewer, await this.find(tx, goalId));
    });
  }

  checkIn(actor: RequestAuth, goalId: string, body: GoalCheckInRequest): Promise<GoalDetail> {
    return this.db.tx(async (tx) => {
      const viewer = await this.viewer(tx, actor);
      const row = await this.findVisible(tx, actor, viewer, goalId);
      await this.assertManage(actor, viewer, row);
      await tx.goalUpdate.create({
        data: {
          goalId,
          authorEmployeeId: viewer.employeeId!,
          progressPct: this.progressOf(row),
          comment: body.comment ?? null,
        },
      });
      return this.detail(tx, actor, viewer, await this.find(tx, goalId));
    });
  }

  /** Called when an employee is deactivated, in the same transaction: their open personal goals are cancelled. */
  async onEmployeeDeactivated(tx: TenantTx, employeeId: string): Promise<void> {
    await tx.goal.updateMany({
      where: {
        scope: 'personal',
        ownerEmployeeId: employeeId,
        status: { in: ['draft', 'active'] },
      },
      data: { status: 'cancelled' },
    });
  }

  // ----- rules ---------------------------------------------------------------------------------

  /** Visible: company goals to everybody with goal.view, team goals to the team, personal goals to those in scope. */
  private async visibleWhere(
    tx: TenantTx,
    actor: RequestAuth,
    viewer: Viewer,
  ): Promise<Prisma.GoalWhereInput> {
    const scope = actor.permissions['goal.view'];
    if (!scope) return { id: { in: [] } };
    if (scope === 'all') return {};
    const everyone = (await tx.employee.findMany({ select: { id: true } })).map((e) => e.id);
    const allowed = [...(await this.authz.allowedEmployees(actor, 'goal.view', everyone))];
    return {
      OR: [
        { scope: 'company' },
        ...(viewer.teamIds.size > 0
          ? [{ scope: 'team', teamId: { in: [...viewer.teamIds] } }]
          : []),
        ...(allowed.length > 0 ? [{ scope: 'personal', ownerEmployeeId: { in: allowed } }] : []),
      ],
    };
  }

  private mayManageTeam(actor: RequestAuth, viewer: Viewer, teamId: string): boolean {
    const scope = actor.permissions['goal.manage_team'];
    if (!scope) return false;
    return scope === 'all' || viewer.led.has(teamId);
  }

  private async mayManage(actor: RequestAuth, viewer: Viewer, row: Row): Promise<boolean> {
    if (row.scope === 'personal') {
      return this.authz.can(actor, 'goal.manage_personal', {
        ownerEmployeeId: row.ownerEmployeeId,
      });
    }
    if (row.scope === 'team')
      return row.teamId !== null && this.mayManageTeam(actor, viewer, row.teamId);
    return Boolean(actor.permissions['goal.manage_company']);
  }

  private async assertManage(actor: RequestAuth, viewer: Viewer, row: Row): Promise<void> {
    if (!viewer.employeeId || !(await this.mayManage(actor, viewer, row))) {
      throw forbidden('Not allowed to change this goal');
    }
  }

  /** The parent is a goal the caller sees, and strictly wider than the goal. */
  private async checkParent(
    tx: TenantTx,
    actor: RequestAuth,
    viewer: Viewer,
    scope: GoalScope,
    parentId: string,
  ): Promise<void> {
    const visible = await this.visibleWhere(tx, actor, viewer);
    const parent = await tx.goal.findFirst({
      where: { AND: [{ id: parentId }, visible] },
      select: { id: true, scope: true },
    });
    if (!parent) throw invalid('parentGoalId', 'parent_not_found', 'This goal does not exist');
    if (!canAlign(scope, parent.scope as GoalScope)) {
      throw invalid('parentGoalId', 'parent_not_wider', 'A goal aligns to a wider goal only');
    }
  }

  private async auditKeyResult(
    tx: TenantTx,
    actor: RequestAuth,
    goalId: string,
    action: 'added' | 'updated' | 'removed',
  ): Promise<void> {
    await this.audit.record(tx, {
      actorUserId: actor.userId,
      action: 'goal.key_result_changed',
      entity: 'goal',
      entityId: goalId,
      after: { action },
    });
  }

  // ----- helpers -------------------------------------------------------------------------------

  private async viewer(tx: TenantTx, actor: RequestAuth): Promise<Viewer> {
    const employee = await tx.employee.findFirst({
      where: { userId: actor.userId, status: 'active' },
      select: { id: true },
    });
    if (!employee) return { employeeId: null, teamIds: new Set(), led: new Set() };
    const [led, member] = await Promise.all([
      tx.team.findMany({ where: { leadEmployeeId: employee.id }, select: { id: true } }),
      tx.teamMember.findMany({ where: { employeeId: employee.id }, select: { teamId: true } }),
    ]);
    return {
      employeeId: employee.id,
      led: new Set(led.map((t) => t.id)),
      teamIds: new Set([...led.map((t) => t.id), ...member.map((m) => m.teamId)]),
    };
  }

  private async find(tx: TenantTx, id: string): Promise<Row> {
    const row = await tx.goal.findUnique({ where: { id }, select: SELECT });
    if (!row) throw notFound('Goal');
    return row;
  }

  private async findVisible(
    tx: TenantTx,
    actor: RequestAuth,
    viewer: Viewer,
    id: string,
  ): Promise<Row> {
    const visible = await this.visibleWhere(tx, actor, viewer);
    const row = await tx.goal.findFirst({ where: { AND: [{ id }, visible] }, select: SELECT });
    if (!row) throw notFound('Goal');
    return row;
  }

  private progressOf(row: Row): number {
    return goalProgress(
      row.progressPct,
      row.keyResults.map((k) => ({
        start: num(k.startValue),
        target: num(k.targetValue),
        current: num(k.currentValue),
      })),
    );
  }

  private async summary(
    actor: RequestAuth,
    viewer: Viewer,
    row: Row,
    today: string,
  ): Promise<GoalSummary> {
    const dueDate = row.dueDate ? dateOut(row.dueDate) : null;
    return {
      id: row.id,
      scope: row.scope as GoalScope,
      owner: { id: row.owner.id, firstName: row.owner.firstName, lastName: row.owner.lastName },
      team: row.team ? { id: row.team.id, name: row.team.name } : null,
      title: row.title,
      status: row.status as GoalStatus,
      dueDate,
      progressPct: this.progressOf(row),
      keyResultCount: row.keyResults.length,
      overdue: isGoalOverdue({ dueDate, status: row.status as GoalStatus }, today),
      parent: row.parent
        ? { id: row.parent.id, title: row.parent.title, scope: row.parent.scope as GoalScope }
        : null,
      canEdit: Boolean(viewer.employeeId) && (await this.mayManage(actor, viewer, row)),
    };
  }

  private async detail(
    tx: TenantTx,
    actor: RequestAuth,
    viewer: Viewer,
    row: Row,
  ): Promise<GoalDetail> {
    const today = await workspaceToday(tx, this.context);
    const visible = await this.visibleWhere(tx, actor, viewer);
    const [updates, children] = await Promise.all([
      tx.goalUpdate.findMany({
        where: { goalId: row.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: {
          id: true,
          progressPct: true,
          comment: true,
          createdAt: true,
          author: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      tx.goal.findMany({
        where: { AND: [{ parentGoalId: row.id }, visible] },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: SELECT,
      }),
    ]);
    const krs: KeyResult[] = row.keyResults.map((k) => ({
      id: k.id,
      title: k.title,
      unit: k.unit,
      startValue: num(k.startValue),
      targetValue: num(k.targetValue),
      currentValue: num(k.currentValue),
      progressPct: keyResultProgress({
        start: num(k.startValue),
        target: num(k.targetValue),
        current: num(k.currentValue),
      }),
    }));
    return {
      ...(await this.summary(actor, viewer, row, today)),
      description: row.description,
      manualProgressPct: row.progressPct,
      keyResults: krs,
      updates: updates.map((u) => ({
        id: u.id,
        author: u.author,
        progressPct: u.progressPct,
        comment: u.comment,
        createdAt: u.createdAt.toISOString(),
      })),
      children: children.map((c) => ({
        id: c.id,
        title: c.title,
        scope: c.scope as GoalScope,
        status: c.status as GoalStatus,
        progressPct: this.progressOf(c),
      })),
    };
  }
}
