import { Injectable } from '@nestjs/common';
import {
  addDays,
  daysBetween,
  eventShapeIssues,
  isOccurrence,
  occurrenceStarts,
  occurrencesIn,
  utcToZoned,
  zonedToUtc,
  type AttendeeResponse,
  type CalendarEvent,
  type CalendarEventList,
  type CalendarScope,
  type CreateEventRequest,
  type EventQuery,
  type Occurrence,
  type RecurrenceRequest,
  type RecurrenceRule,
  type RespondRequest,
  type SeriesScopeQuery,
  type UpdateEventRequest,
} from '@intime/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import {
  EVENT_SELECT,
  dateIn,
  dateOut,
  durationDays,
  forbidden,
  invalid,
  notFound,
  ruleColumns,
  ruleOf,
  type EventRow,
} from './calendar.shared.js';

interface Viewer {
  employeeId: string | null;
  /** Teams the viewer leads or belongs to. */
  teamIds: Set<string>;
}

/** The fields of an event that can be edited, as local dates and times. */
interface Shape {
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
}

/**
 * Personal, team and company events with repeats, guests and answers
 * (docs/adr/0010-calendar.md, docs/adr/0028-calendar-advanced.md). Leave and holidays are layers read elsewhere.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ----- reading -------------------------------------------------------------------------------

  list(actor: RequestAuth, query: EventQuery): Promise<CalendarEventList> {
    return this.db.tx(async (tx) => {
      const zone = await this.zone(tx);
      const viewer = await this.viewer(tx, actor);
      const rows = await tx.calendarEvent.findMany({
        where: {
          AND: [
            { startDate: { lte: dateIn(query.to) } },
            {
              OR: [
                { recurrenceFreq: null, endDate: { gte: dateIn(query.from) } },
                {
                  recurrenceFreq: { not: null },
                  OR: [
                    { recurrenceUntil: null },
                    // an occurrence starting on the last day can last up to 31 more days
                    { recurrenceUntil: { gte: dateIn(addDays(query.from, -31)) } },
                  ],
                },
              ],
            },
            { OR: this.visibleTo(actor, viewer) },
          ],
        },
        select: EVENT_SELECT,
        orderBy: [{ startDate: 'asc' }, { startsAt: 'asc' }, { id: 'asc' }],
        take: 1000,
      });
      const items: CalendarEvent[] = [];
      for (const row of rows) {
        const rule = ruleOf(row);
        if (!rule) {
          items.push(this.present(row, zone, actor, viewer));
          continue;
        }
        const cancelled = new Set(row.exceptions.map((e) => dateOut(e.originalDate)));
        for (const occurrence of occurrencesIn(
          dateOut(row.startDate),
          durationDays(row),
          rule,
          query.from,
          query.to,
          cancelled,
        )) {
          items.push(this.present(row, zone, actor, viewer, occurrence));
        }
      }
      items.sort(
        (a, b) =>
          a.startDate.localeCompare(b.startDate) ||
          (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
          a.id.localeCompare(b.id),
      );
      return { items };
    });
  }

  // ----- writing -------------------------------------------------------------------------------

  create(actor: RequestAuth, body: CreateEventRequest): Promise<CalendarEvent> {
    return this.db.tx(async (tx) => {
      const zone = await this.zone(tx);
      const viewer = await this.viewer(tx, actor);
      if (!viewer.employeeId) throw notFound('Employee record');
      if (body.scope === 'team') await this.assertTeamExists(tx, body.teamId!);
      this.assertMayManage(actor, viewer, body.scope, body.teamId ?? null, viewer.employeeId);
      const rule = body.recurrence ?? null;
      const times = this.times(body, zone);
      const guests = await this.guestEmployees(tx, body.attendeeIds ?? [], viewer.employeeId);
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
          ...ruleColumns(rule),
          reminderMinutes: body.reminderMinutes ?? null,
        },
        select: { id: true },
      });
      await tx.calendarAttendee.createMany({
        data: guests.map((g) => ({ eventId: id, employeeId: g.id })),
      });
      for (const g of guests) {
        await this.notify(tx, 'calendar.invited', g.userId, { eventId: id, date: body.startDate });
      }
      const row = await this.find(tx, id);
      await this.auditChange(tx, actor, 'created', row);
      return this.present(row, zone, actor, viewer);
    });
  }

  update(
    actor: RequestAuth,
    id: string,
    body: UpdateEventRequest,
    scope: SeriesScopeQuery,
  ): Promise<CalendarEvent> {
    return this.db.tx(async (tx) => {
      const zone = await this.zone(tx);
      const viewer = await this.viewer(tx, actor);
      const row = await this.visible(tx, actor, viewer, id);
      this.assertMayManage(
        actor,
        viewer,
        row.scope as CalendarScope,
        row.teamId,
        row.ownerEmployeeId,
      );
      if (body.attendeeIds && row.scope !== 'personal') {
        throw invalid('attendeeIds', 'guests_not_allowed', 'Only personal events have guests');
      }
      const rule = ruleOf(row);
      let mode = scope.mode;
      const occurrence = scope.occurrence;
      if (mode !== 'all') {
        if (!rule) throw invalid('mode', 'not_recurring', 'The event does not repeat');
        this.assertOccurrence(row, rule, occurrence!);
        if (mode === 'following' && occurrence === dateOut(row.startDate)) mode = 'all'; // it is the whole series
      }

      let saved: Row2;
      if (mode === 'all') {
        saved = await this.updateAll(tx, row, body, zone, occurrence, viewer);
      } else if (mode === 'this') {
        saved = await this.updateThis(tx, row, rule!, body, zone, occurrence!, viewer);
      } else {
        saved = await this.updateFollowing(tx, row, rule!, body, zone, occurrence!, viewer);
      }
      await this.auditChange(tx, actor, 'updated', saved.row);
      return this.present(saved.row, zone, actor, viewer, saved.occurrence);
    });
  }

  remove(actor: RequestAuth, id: string, scope: SeriesScopeQuery): Promise<void> {
    return this.db.tx(async (tx) => {
      const viewer = await this.viewer(tx, actor);
      const row = await this.visible(tx, actor, viewer, id);
      this.assertMayManage(
        actor,
        viewer,
        row.scope as CalendarScope,
        row.teamId,
        row.ownerEmployeeId,
      );
      const rule = ruleOf(row);
      const start = dateOut(row.startDate);
      let mode = scope.mode;
      if (mode !== 'all') {
        if (!rule) throw invalid('mode', 'not_recurring', 'The event does not repeat');
        this.assertOccurrence(row, rule, scope.occurrence!);
        if (mode === 'following' && scope.occurrence === start) mode = 'all';
      }
      if (mode === 'all') {
        await this.tellGuests(tx, row, 'cancelled', scope.occurrence ?? start);
        await tx.calendarEvent.delete({ where: { id } });
      } else if (mode === 'this') {
        await tx.calendarEventException.create({
          data: { eventId: id, originalDate: dateIn(scope.occurrence!) },
        });
        await this.tellGuests(tx, row, 'cancelled', scope.occurrence!);
      } else {
        await this.endSeriesBefore(tx, row, rule!, scope.occurrence!);
        await this.tellGuests(tx, row, 'cancelled', scope.occurrence!);
      }
      await this.auditChange(tx, actor, 'deleted', row);
    });
  }

  /** A guest answers; the organizer is told when the answer changed. */
  respond(actor: RequestAuth, id: string, body: RespondRequest): Promise<CalendarEvent> {
    return this.db.tx(async (tx) => {
      const zone = await this.zone(tx);
      const viewer = await this.viewer(tx, actor);
      const row = await this.visible(tx, actor, viewer, id);
      const mine = row.attendees.find((a) => a.employeeId === viewer.employeeId);
      if (!mine) throw notFound('Event'); // only guests answer
      if (mine.response !== body.response) {
        await tx.calendarAttendee.update({
          where: { id: mine.id },
          data: { response: body.response, respondedAt: new Date() },
        });
        await this.notify(tx, 'calendar.response', row.owner.userId, {
          eventId: row.id,
          date: dateOut(row.startDate),
          response: body.response,
        });
      }
      return this.present(await this.find(tx, id), zone, actor, viewer);
    });
  }

  // ----- series editing ------------------------------------------------------------------------

  private async updateAll(
    tx: TenantTx,
    row: EventRow,
    body: UpdateEventRequest,
    zone: string,
    occurrence: string | undefined,
    viewer: Viewer,
  ): Promise<Row2> {
    const current = this.shapeOf(row, zone);
    const length = durationDays(row);
    // Editing an occurrence "for all" moves the series by as much as the occurrence was moved.
    let startDate = body.startDate ?? current.startDate;
    let endDate = body.endDate ?? current.endDate;
    if (occurrence && ruleOf(row)) {
      if (body.startDate !== undefined) {
        const shift = daysBetween(occurrence, body.startDate);
        startDate = addDays(current.startDate, shift);
        endDate = addDays(
          startDate,
          body.endDate !== undefined ? daysBetween(body.startDate, body.endDate) : length,
        );
      } else if (body.endDate !== undefined) {
        startDate = current.startDate;
        endDate = addDays(current.startDate, daysBetween(occurrence, body.endDate));
      }
    }
    const merged = { ...this.merge({ ...current, startDate, endDate }, body), startDate, endDate };
    const issue = eventShapeIssues({
      ...merged,
      scope: row.scope as CalendarScope,
      teamId: row.teamId,
    })[0];
    if (issue) throw invalid(issue.path, issue.code, 'The event is not valid');

    const oldRule = ruleOf(row);
    const rule = this.nextRule(oldRule, body.recurrence);
    if (rule?.until && rule.until < merged.startDate) {
      throw invalid('recurrence.until', 'end_before_start', 'The series ends before it starts');
    }
    if (rule && daysBetween(merged.startDate, merged.endDate) + 1 > 31) {
      throw invalid('endDate', 'too_long', 'The event is too long');
    }
    if (body.reminderMinutes && row.scope === 'company') {
      throw invalid('reminderMinutes', 'reminder_not_allowed', 'Company events have no reminder');
    }
    const scheduleChanged =
      merged.allDay !== current.allDay ||
      merged.startDate !== current.startDate ||
      merged.endDate !== current.endDate ||
      merged.startTime !== current.startTime ||
      merged.endTime !== current.endTime ||
      JSON.stringify(rule) !== JSON.stringify(oldRule);

    await tx.calendarEvent.update({
      where: { id: row.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        allDay: merged.allDay,
        startDate: dateIn(merged.startDate),
        endDate: dateIn(merged.endDate),
        ...this.times(merged, zone),
        ...ruleColumns(rule),
        ...(body.reminderMinutes !== undefined ? { reminderMinutes: body.reminderMinutes } : {}),
      },
    });
    // A new time or lead gets its own reminder (ADR 0029).
    if (
      scheduleChanged ||
      (body.reminderMinutes !== undefined && body.reminderMinutes !== row.reminderMinutes)
    ) {
      await tx.calendarReminder.deleteMany({ where: { eventId: row.id } });
    }
    // A moved series cancels nothing by itself, but dates that no longer exist in it make no sense.
    if (scheduleChanged && merged.startDate !== current.startDate) {
      await tx.calendarEventException.deleteMany({ where: { eventId: row.id } });
    }
    await this.syncGuests(tx, row, body.attendeeIds, viewer, scheduleChanged, merged.startDate);
    return { row: await this.find(tx, row.id), occurrence: undefined };
  }

  private async updateThis(
    tx: TenantTx,
    row: EventRow,
    rule: RecurrenceRule,
    body: UpdateEventRequest,
    zone: string,
    occurrence: string,
    viewer: Viewer,
  ): Promise<Row2> {
    void rule;
    const merged = this.mergedAt(row, zone, occurrence, body);
    await tx.calendarEventException.create({
      data: { eventId: row.id, originalDate: dateIn(occurrence) },
    });
    // The changed occurrence becomes a one-off event with the same guests.
    const created = await this.copyEvent(tx, row, merged, null, zone, body);
    const guestIds = body.attendeeIds ?? row.attendees.map((a) => a.employeeId);
    const known = new Set(row.attendees.map((a) => a.employeeId));
    const guests = await this.guestEmployees(tx, guestIds, row.ownerEmployeeId);
    await tx.calendarAttendee.createMany({
      data: guests.map((g) => ({ eventId: created, employeeId: g.id })),
    });
    for (const g of guests) {
      if (known.has(g.id)) {
        await this.notify(tx, 'calendar.changed', g.userId, {
          eventId: created,
          date: merged.startDate,
          action: 'updated',
        });
      } else {
        await this.notify(tx, 'calendar.invited', g.userId, {
          eventId: created,
          date: merged.startDate,
        });
      }
    }
    // Guests dropped from this occurrence are told nothing (they were never told it was theirs alone).
    void viewer;
    return { row: await this.find(tx, created), occurrence: undefined };
  }

  private async updateFollowing(
    tx: TenantTx,
    row: EventRow,
    rule: RecurrenceRule,
    body: UpdateEventRequest,
    zone: string,
    occurrence: string,
    viewer: Viewer,
  ): Promise<Row2> {
    void viewer;
    const merged = this.mergedAt(row, zone, occurrence, body);
    const start = dateOut(row.startDate);
    const before = occurrenceStarts(start, rule, start, addDays(occurrence, -1)).length;
    const nextRule =
      body.recurrence === undefined
        ? { ...rule, until: rule.until, count: rule.count === null ? null : rule.count - before }
        : this.nextRule(null, body.recurrence);
    if (nextRule && nextRule.until && nextRule.until < merged.startDate) {
      throw invalid('recurrence.until', 'end_before_start', 'The series ends before it starts');
    }
    await this.endSeriesBefore(tx, row, rule, occurrence, false);
    const created = await this.copyEvent(tx, row, merged, nextRule, zone, body);
    // Cancelled dates from the split on belong to the new series.
    await tx.calendarEventException.updateMany({
      where: { eventId: row.id, originalDate: { gte: dateIn(occurrence) } },
      data: { eventId: created },
    });
    const guestIds = body.attendeeIds ?? row.attendees.map((a) => a.employeeId);
    const known = new Set(row.attendees.map((a) => a.employeeId));
    const guests = await this.guestEmployees(tx, guestIds, row.ownerEmployeeId);
    await tx.calendarAttendee.createMany({
      data: guests.map((g) => ({ eventId: created, employeeId: g.id })),
    });
    for (const g of guests) {
      if (known.has(g.id)) {
        await this.notify(tx, 'calendar.changed', g.userId, {
          eventId: created,
          date: merged.startDate,
          action: 'updated',
        });
      } else {
        await this.notify(tx, 'calendar.invited', g.userId, {
          eventId: created,
          date: merged.startDate,
        });
      }
    }
    return { row: await this.find(tx, created), occurrence: undefined };
  }

  /** Ends the series on the day before `occurrence`; the series disappears when nothing is left of it. */
  private async endSeriesBefore(
    tx: TenantTx,
    row: EventRow,
    rule: RecurrenceRule,
    occurrence: string,
    dropExceptions = true,
  ): Promise<void> {
    void rule;
    await tx.calendarEvent.update({
      where: { id: row.id },
      data: { recurrenceUntil: dateIn(addDays(occurrence, -1)), recurrenceCount: null },
    });
    if (dropExceptions) {
      await tx.calendarEventException.deleteMany({
        where: { eventId: row.id, originalDate: { gte: dateIn(occurrence) } },
      });
    }
  }

  /** The event as it looks on one occurrence, with the changes of the request applied. */
  private mergedAt(
    row: EventRow,
    zone: string,
    occurrence: string,
    body: UpdateEventRequest,
  ): Shape {
    const current = this.shapeOf(row, zone);
    const length = durationDays(row);
    const base = { ...current, startDate: occurrence, endDate: addDays(occurrence, length) };
    const merged = this.merge(base, body);
    const issue = eventShapeIssues({
      ...merged,
      scope: row.scope as CalendarScope,
      teamId: row.teamId,
    })[0];
    if (issue) throw invalid(issue.path, issue.code, 'The event is not valid');
    return merged;
  }

  private merge(current: Shape, body: UpdateEventRequest): Shape {
    const merged: Shape = {
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
    return merged;
  }

  /** `undefined` keeps the rule, `null` removes it, an object replaces it. */
  private nextRule(
    current: RecurrenceRule | null,
    requested: RecurrenceRequest | null | undefined,
  ): RecurrenceRule | null {
    if (requested === undefined) return current;
    return requested;
  }

  private async copyEvent(
    tx: TenantTx,
    row: EventRow,
    shape: Shape,
    rule: RecurrenceRule | null,
    zone: string,
    body: UpdateEventRequest,
  ): Promise<string> {
    const { id } = await tx.calendarEvent.create({
      data: {
        scope: row.scope,
        ownerEmployeeId: row.ownerEmployeeId,
        teamId: row.teamId,
        title: body.title ?? row.title,
        description: body.description === undefined ? row.description : body.description,
        location: body.location === undefined ? row.location : body.location,
        allDay: shape.allDay,
        startDate: dateIn(shape.startDate),
        endDate: dateIn(shape.endDate),
        ...this.times(shape, zone),
        ...ruleColumns(rule),
        reminderMinutes:
          body.reminderMinutes === undefined ? row.reminderMinutes : body.reminderMinutes,
      },
      select: { id: true },
    });
    return id;
  }

  // ----- guests --------------------------------------------------------------------------------

  /** Active employees for a guest list; anything else (unknown, inactive, the organizer) is a validation error. */
  private async guestEmployees(
    tx: TenantTx,
    ids: readonly string[],
    organizerId: string,
  ): Promise<{ id: string; userId: string | null }[]> {
    if (ids.length === 0) return [];
    if (ids.includes(organizerId)) {
      throw invalid('attendeeIds', 'organizer_is_guest', 'The organizer is not a guest');
    }
    const found = await tx.employee.findMany({
      where: { id: { in: [...ids] }, status: 'active' },
      select: { id: true, userId: true },
    });
    if (found.length !== new Set(ids).size) {
      throw invalid('attendeeIds', 'unknown_employee', 'Unknown or inactive employee');
    }
    return found;
  }

  /** Replaces the guest list, tells new guests, and (when the schedule changed) resets and tells the others. */
  private async syncGuests(
    tx: TenantTx,
    row: EventRow,
    requested: string[] | undefined,
    viewer: Viewer,
    scheduleChanged: boolean,
    date: string,
  ): Promise<void> {
    void viewer;
    const current = new Map(row.attendees.map((a) => [a.employeeId, a]));
    const wanted = requested ?? [...current.keys()];
    const guests = await this.guestEmployees(tx, wanted, row.ownerEmployeeId);
    const wantedIds = new Set(guests.map((g) => g.id));

    const removed = [...current.keys()].filter((id) => !wantedIds.has(id));
    if (removed.length > 0) {
      await tx.calendarAttendee.deleteMany({
        where: { eventId: row.id, employeeId: { in: removed } },
      });
    }
    const added = guests.filter((g) => !current.has(g.id));
    if (added.length > 0) {
      await tx.calendarAttendee.createMany({
        data: added.map((g) => ({ eventId: row.id, employeeId: g.id })),
      });
      for (const g of added) {
        await this.notify(tx, 'calendar.invited', g.userId, { eventId: row.id, date });
      }
    }
    if (scheduleChanged) {
      const kept = guests.filter((g) => current.has(g.id));
      if (kept.length > 0) {
        await tx.calendarAttendee.updateMany({
          where: { eventId: row.id, employeeId: { in: kept.map((g) => g.id) } },
          data: { response: 'needs_action', respondedAt: null },
        });
        for (const g of kept) {
          await this.notify(tx, 'calendar.changed', g.userId, {
            eventId: row.id,
            date,
            action: 'updated',
          });
        }
      }
    }
  }

  private async tellGuests(
    tx: TenantTx,
    row: EventRow,
    action: 'updated' | 'cancelled',
    date: string,
  ): Promise<void> {
    for (const a of row.attendees) {
      await this.notify(tx, 'calendar.changed', a.employee.userId, {
        eventId: row.id,
        date,
        action,
      });
    }
  }

  /** Queues a notification in the same transaction; people without an account get none. */
  private async notify(
    tx: TenantTx,
    type: 'calendar.invited' | 'calendar.response' | 'calendar.changed',
    userId: string | null,
    params: Record<string, string>,
  ): Promise<void> {
    if (!userId) return;
    // The outbox validates the params against the event definition.
    await this.outbox.publish(tx, type, { recipientUserId: userId, ...params } as never);
  }

  // ----- rules ---------------------------------------------------------------------------------

  /**
   * What the viewer may see: company events, own personal events and the ones they are invited to, events of their
   * teams (or any, with scope all).
   */
  private visibleTo(actor: RequestAuth, viewer: Viewer): Prisma.CalendarEventWhereInput[] {
    const clauses: Prisma.CalendarEventWhereInput[] = [{ scope: 'company' }];
    if (viewer.employeeId) {
      clauses.push({ scope: 'personal', ownerEmployeeId: viewer.employeeId });
      clauses.push({
        scope: 'personal',
        attendees: { some: { employeeId: viewer.employeeId } },
      });
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
    ownerId: string,
  ): boolean {
    if (scope === 'company') return Boolean(actor.permissions['calendar.manage_company_calendar']);
    // A guest sees a personal event but does not manage it.
    if (scope === 'personal') {
      return Boolean(actor.permissions['calendar.manage_own']) && ownerId === viewer.employeeId;
    }
    const held = actor.permissions['calendar.manage_team_calendars'];
    if (!held || !teamId) return false;
    return held === 'all' || viewer.teamIds.has(teamId);
  }

  private assertMayManage(
    actor: RequestAuth,
    viewer: Viewer,
    scope: CalendarScope,
    teamId: string | null,
    ownerId: string,
  ): void {
    if (!this.mayManage(actor, viewer, scope, teamId, ownerId)) {
      throw forbidden(`Not allowed to change ${scope} events`);
    }
  }

  /** An event the viewer cannot see does not exist for them. */
  private async visible(
    tx: TenantTx,
    actor: RequestAuth,
    viewer: Viewer,
    id: string,
  ): Promise<EventRow> {
    const row = await tx.calendarEvent.findFirst({
      where: { id, OR: this.visibleTo(actor, viewer) },
      select: EVENT_SELECT,
    });
    if (!row) throw notFound('Event');
    return row;
  }

  /** The occurrence must be a date of the series and not cancelled. */
  private assertOccurrence(row: EventRow, rule: RecurrenceRule, occurrence: string): void {
    const cancelled = row.exceptions.some((e) => dateOut(e.originalDate) === occurrence);
    if (cancelled || !isOccurrence(dateOut(row.startDate), rule, occurrence)) {
      throw notFound('Occurrence');
    }
  }

  // ----- helpers -------------------------------------------------------------------------------

  private async zone(tx: TenantTx): Promise<string> {
    const tenant = await tx.tenant.findUnique({
      where: { id: this.context.requireTenantId() },
      select: { defaultTimezone: true },
    });
    return tenant?.defaultTimezone ?? 'UTC';
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

  private async find(tx: TenantTx, id: string): Promise<EventRow> {
    const row = await tx.calendarEvent.findUnique({ where: { id }, select: EVENT_SELECT });
    if (!row) throw notFound('Event');
    return row;
  }

  /** The instants of a timed event in the workspace time zone; all-day events have none. */
  private times(
    shape: {
      allDay: boolean;
      startDate: string;
      endDate: string;
      startTime?: string | null | undefined;
      endTime?: string | null | undefined;
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

  private shapeOf(row: EventRow, zone: string): Shape {
    return {
      allDay: row.allDay,
      startDate: dateOut(row.startDate),
      endDate: dateOut(row.endDate),
      startTime: row.startsAt ? utcToZoned(row.startsAt, zone).time : null,
      endTime: row.endsAt ? utcToZoned(row.endsAt, zone).time : null,
    };
  }

  private present(
    row: EventRow,
    zone: string,
    actor: RequestAuth,
    viewer: Viewer,
    occurrence?: Occurrence,
  ): CalendarEvent {
    const shape = this.shapeOf(row, zone);
    const rule = ruleOf(row);
    const mine = row.attendees.find((a) => a.employeeId === viewer.employeeId);
    const attendees = [...row.attendees]
      .sort(
        (a, b) =>
          a.employee.lastName.localeCompare(b.employee.lastName) ||
          a.employee.firstName.localeCompare(b.employee.firstName) ||
          a.id.localeCompare(b.id),
      )
      .map((a) => ({
        employee: {
          id: a.employee.id,
          firstName: a.employee.firstName,
          lastName: a.employee.lastName,
        },
        response: a.response as AttendeeResponse,
      }));
    return {
      id: row.id,
      scope: row.scope as CalendarScope,
      team: row.team,
      owner: { id: row.owner.id, firstName: row.owner.firstName, lastName: row.owner.lastName },
      title: row.title,
      description: row.description,
      location: row.location,
      ...shape,
      ...(occurrence ? { startDate: occurrence.startDate, endDate: occurrence.endDate } : {}),
      canEdit: this.mayManage(
        actor,
        viewer,
        row.scope as CalendarScope,
        row.teamId,
        row.ownerEmployeeId,
      ),
      recurrence: rule && { ...rule, weekdays: [...rule.weekdays] },
      occurrenceDate: occurrence?.startDate ?? shape.startDate,
      isOrganizer: row.ownerEmployeeId === viewer.employeeId,
      attendees,
      myResponse: mine ? (mine.response as AttendeeResponse) : null,
      reminderMinutes: row.reminderMinutes,
    };
  }

  /** Team and company changes are audited with ids and the action only; personal events are not. */
  private async auditChange(
    tx: TenantTx,
    actor: RequestAuth,
    action: 'created' | 'updated' | 'deleted',
    row: EventRow,
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

/** The saved row of an edit and the occurrence it should be shown at (none = the event itself). */
interface Row2 {
  row: EventRow;
  occurrence: Occurrence | undefined;
}
