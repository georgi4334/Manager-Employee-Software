import { Injectable } from '@nestjs/common';
import {
  eventShapeIssues,
  utcToZoned,
  zonedToUtc,
  type CalendarEvent,
  type CalendarEventList,
  type CalendarScope,
  type CreateEventRequest,
  type EventQuery,
  type UpdateEventRequest,
} from '@intime/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';

const dateOut = (date: Date): string => date.toISOString().slice(0, 10);
const dateIn = (value: string): Date => new Date(`${value}T00:00:00Z`);
const notFound = (what: string) => new AppException('NOT_FOUND', { message: `${what} not found` });
const forbidden = (message: string) => new AppException('FORBIDDEN', { message });
const invalid = (path: string, code: string, message: string) =>
  new AppException('VALIDATION_FAILED', { details: [{ path, code, message }] });

const SELECT = {
  id: true,
  scope: true,
  ownerEmployeeId: true,
  teamId: true,
  title: true,
  description: true,
  location: true,
  allDay: true,
  startDate: true,
  endDate: true,
  startsAt: true,
  endsAt: true,
  owner: { select: { id: true, firstName: true, lastName: true, userId: true } },
  team: { select: { id: true, name: true } },
} satisfies Prisma.CalendarEventSelect;

type Row = Prisma.CalendarEventGetPayload<{ select: typeof SELECT }>;

interface Viewer {
  employeeId: string | null;
  /** Teams the viewer leads or belongs to. */
  teamIds: Set<string>;
}

/** Personal, team and company events (docs/adr/0010-calendar.md). Leave and holidays are layers read elsewhere. */
@Injectable()
export class CalendarService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  list(actor: RequestAuth, query: EventQuery): Promise<CalendarEventList> {
    return this.db.tx(async (tx) => {
      const { zone } = await this.zone(tx);
      const viewer = await this.viewer(tx, actor);
      const rows = await tx.calendarEvent.findMany({
        where: {
          startDate: { lte: dateIn(query.to) },
          endDate: { gte: dateIn(query.from) },
          OR: this.visibleTo(actor, viewer),
        },
        select: SELECT,
        orderBy: [{ startDate: 'asc' }, { startsAt: 'asc' }, { id: 'asc' }],
        take: 1000,
      });
      return { items: rows.map((row) => this.present(row, zone, actor, viewer)) };
    });
  }

  create(actor: RequestAuth, body: CreateEventRequest): Promise<CalendarEvent> {
    return this.db.tx(async (tx) => {
      const { zone } = await this.zone(tx);
      const viewer = await this.viewer(tx, actor);
      if (!viewer.employeeId) throw notFound('Employee record');
      if (body.scope === 'team') await this.assertTeamExists(tx, body.teamId!);
      this.assertMayManage(actor, viewer, body.scope, body.teamId ?? null);
      const times = this.times(body, zone);
      const { id } = await tx.calendarEvent.create({
        data: {
          scope: body.scope,
          ownerEmployeeId: viewer.employeeId,
          teamId: body.scope === 'team' ? body.teamId! : null,
          title: body.title,
          description: body.description ?? null,
          location: body.location ?? null,
          allDay: body.allDay,
          startDate: dateIn(body.startDate),
          endDate: dateIn(body.endDate),
          ...times,
        },
        select: { id: true },
      });
      const row = await this.find(tx, id);
      await this.auditChange(tx, actor, 'created', row);
      return this.present(row, zone, actor, viewer);
    });
  }

  update(actor: RequestAuth, id: string, body: UpdateEventRequest): Promise<CalendarEvent> {
    return this.db.tx(async (tx) => {
      const { zone } = await this.zone(tx);
      const viewer = await this.viewer(tx, actor);
      const row = await this.visible(tx, actor, viewer, id);
      this.assertMayManage(actor, viewer, row.scope as CalendarScope, row.teamId);

      const current = this.shapeOf(row, zone);
      const merged = {
        ...current,
        allDay: body.allDay ?? current.allDay,
        startDate: body.startDate ?? current.startDate,
        endDate: body.endDate ?? current.endDate,
        startTime: body.startTime === undefined ? current.startTime : body.startTime,
        endTime: body.endTime === undefined ? current.endTime : body.endTime,
      };
      // Switching to all-day drops the times unless the caller said otherwise; switching away needs them.
      if (body.allDay === true) {
        if (body.startTime === undefined) merged.startTime = null;
        if (body.endTime === undefined) merged.endTime = null;
      }
      const issue = eventShapeIssues({
        ...merged,
        scope: row.scope as CalendarScope,
        teamId: row.teamId,
      })[0];
      if (issue) throw invalid(issue.path, issue.code, 'The event is not valid');

      await tx.calendarEvent.update({
        where: { id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.location !== undefined ? { location: body.location } : {}),
          allDay: merged.allDay,
          startDate: dateIn(merged.startDate),
          endDate: dateIn(merged.endDate),
          ...this.times(
            {
              allDay: merged.allDay,
              startDate: merged.startDate,
              endDate: merged.endDate,
              startTime: merged.startTime ?? undefined,
              endTime: merged.endTime ?? undefined,
            },
            zone,
          ),
        },
      });
      const updated = await this.find(tx, id);
      await this.auditChange(tx, actor, 'updated', updated);
      return this.present(updated, zone, actor, viewer);
    });
  }

  remove(actor: RequestAuth, id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const viewer = await this.viewer(tx, actor);
      const row = await this.visible(tx, actor, viewer, id);
      this.assertMayManage(actor, viewer, row.scope as CalendarScope, row.teamId);
      await tx.calendarEvent.delete({ where: { id } });
      await this.auditChange(tx, actor, 'deleted', row);
    });
  }

  // ----- rules ---------------------------------------------------------------------------------

  /** What the viewer may see: company events, own personal events, events of their teams (or any, with scope all). */
  private visibleTo(actor: RequestAuth, viewer: Viewer): Prisma.CalendarEventWhereInput[] {
    const clauses: Prisma.CalendarEventWhereInput[] = [{ scope: 'company' }];
    if (viewer.employeeId) {
      clauses.push({ scope: 'personal', ownerEmployeeId: viewer.employeeId });
    }
    if (actor.permissions['calendar.manage_team_calendars'] === 'all') {
      clauses.push({ scope: 'team' });
    } else if (viewer.teamIds.size > 0) {
      clauses.push({ scope: 'team', teamId: { in: [...viewer.teamIds] } });
    }
    return clauses;
  }

  private mayManage(
    actor: RequestAuth,
    viewer: Viewer,
    scope: CalendarScope,
    teamId: string | null,
  ): boolean {
    if (scope === 'company') return Boolean(actor.permissions['calendar.manage_company_calendar']);
    if (scope === 'personal') return Boolean(actor.permissions['calendar.manage_own']);
    const held = actor.permissions['calendar.manage_team_calendars'];
    if (!held || !teamId) return false;
    return held === 'all' || viewer.teamIds.has(teamId);
  }

  private assertMayManage(
    actor: RequestAuth,
    viewer: Viewer,
    scope: CalendarScope,
    teamId: string | null,
  ): void {
    if (!this.mayManage(actor, viewer, scope, teamId)) {
      throw forbidden(`Not allowed to change ${scope} events`);
    }
  }

  /** An event the viewer cannot see does not exist for them. */
  private async visible(
    tx: TenantTx,
    actor: RequestAuth,
    viewer: Viewer,
    id: string,
  ): Promise<Row> {
    const row = await tx.calendarEvent.findFirst({
      where: { id, OR: this.visibleTo(actor, viewer) },
      select: SELECT,
    });
    if (!row) throw notFound('Event');
    return row;
  }

  // ----- helpers -------------------------------------------------------------------------------

  private async zone(tx: TenantTx): Promise<{ zone: string }> {
    const tenant = await tx.tenant.findUnique({
      where: { id: this.context.requireTenantId() },
      select: { defaultTimezone: true },
    });
    return { zone: tenant?.defaultTimezone ?? 'UTC' };
  }

  private async viewer(tx: TenantTx, actor: RequestAuth): Promise<Viewer> {
    const employee = await tx.employee.findFirst({
      where: { userId: actor.userId, status: 'active' },
      select: { id: true },
    });
    if (!employee) return { employeeId: null, teamIds: new Set() };
    const [led, member] = await Promise.all([
      tx.team.findMany({ where: { leadEmployeeId: employee.id }, select: { id: true } }),
      tx.teamMember.findMany({ where: { employeeId: employee.id }, select: { teamId: true } }),
    ]);
    return {
      employeeId: employee.id,
      teamIds: new Set([...led.map((t) => t.id), ...member.map((m) => m.teamId)]),
    };
  }

  private async assertTeamExists(tx: TenantTx, teamId: string): Promise<void> {
    if (!(await tx.team.findUnique({ where: { id: teamId }, select: { id: true } }))) {
      throw notFound('Team');
    }
  }

  private async find(tx: TenantTx, id: string): Promise<Row> {
    const row = await tx.calendarEvent.findUnique({ where: { id }, select: SELECT });
    if (!row) throw notFound('Event');
    return row;
  }

  /** The instants of a timed event in the workspace time zone; all-day events have none. */
  private times(
    shape: {
      allDay: boolean;
      startDate: string;
      endDate: string;
      startTime?: string;
      endTime?: string;
    },
    zone: string,
  ): { startsAt: Date | null; endsAt: Date | null } {
    if (shape.allDay) return { startsAt: null, endsAt: null };
    const startsAt = zonedToUtc(shape.startDate, shape.startTime!, zone);
    const endsAt = zonedToUtc(shape.endDate, shape.endTime!, zone);
    if (!startsAt)
      throw invalid('startTime', 'nonexistent_time', 'This time does not exist on that day');
    if (!endsAt)
      throw invalid('endTime', 'nonexistent_time', 'This time does not exist on that day');
    if (endsAt <= startsAt)
      throw invalid('endTime', 'end_before_start', 'The end must be after the start');
    return { startsAt, endsAt };
  }

  private shapeOf(row: Row, zone: string) {
    return {
      allDay: row.allDay,
      startDate: dateOut(row.startDate),
      endDate: dateOut(row.endDate),
      startTime: row.startsAt ? utcToZoned(row.startsAt, zone).time : null,
      endTime: row.endsAt ? utcToZoned(row.endsAt, zone).time : null,
    };
  }

  private present(row: Row, zone: string, actor: RequestAuth, viewer: Viewer): CalendarEvent {
    const shape = this.shapeOf(row, zone);
    return {
      id: row.id,
      scope: row.scope as CalendarScope,
      team: row.team,
      owner: { id: row.owner.id, firstName: row.owner.firstName, lastName: row.owner.lastName },
      title: row.title,
      description: row.description,
      location: row.location,
      ...shape,
      canEdit: this.mayManage(actor, viewer, row.scope as CalendarScope, row.teamId),
    };
  }

  /** Team and company changes are audited with ids and the action only; personal events are not. */
  private async auditChange(
    tx: TenantTx,
    actor: RequestAuth,
    action: 'created' | 'updated' | 'deleted',
    row: Row,
  ): Promise<void> {
    if (row.scope === 'personal') return;
    await this.audit.record(tx, {
      actorUserId: actor.userId,
      action: `calendar.event_${action}`,
      entity: 'calendar_event',
      entityId: row.id,
      after: { scope: row.scope, teamId: row.teamId },
    });
  }
}
