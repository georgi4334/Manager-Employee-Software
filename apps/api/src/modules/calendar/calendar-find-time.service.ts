import { Injectable } from '@nestjs/common';
import {
  FIND_TIME_WINDOW,
  addDays,
  daysBetween,
  eachDay,
  findSlots,
  minutesToTime,
  occurrencesIn,
  scheduledMinutes,
  utcToZoned,
  type DayAvailability,
  type FindTimeRequest,
  type FindTimeResponse,
  type Interval,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { TenantContext } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { LeaveSettingsService } from '../leave/leave-settings.service.js';
import { SchedulesService } from '../schedules/schedules.service.js';
import { dateIn, dateOut, durationDays, invalid, ruleOf } from './calendar.shared.js';

const toMinutes = (time: string): number =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/**
 * Free/busy across people (docs/adr/0028-calendar-advanced.md): suggests slots where everybody is free and returns nothing
 * but the slots, never why somebody is busy.
 */
@Injectable()
export class CalendarFindTimeService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly settings: LeaveSettingsService,
    private readonly schedules: SchedulesService,
  ) {}

  find(_actor: RequestAuth, body: FindTimeRequest): Promise<FindTimeResponse> {
    return this.db.tx(async (tx) => {
      const { from, to } = body;
      const tenant = await tx.tenant.findUnique({
        where: { id: this.context.requireTenantId() },
        select: { defaultTimezone: true },
      });
      const zone = tenant?.defaultTimezone ?? 'UTC';

      const people = await tx.employee.findMany({
        where: { id: { in: body.employeeIds }, status: 'active' },
        select: { id: true, country: true, hireDate: true, terminationDate: true },
      });
      if (people.length !== body.employeeIds.length) {
        throw invalid('employeeIds', 'unknown_employee', 'Unknown or inactive employee');
      }
      const ids = people.map((p) => p.id);
      const fallbackCountry = (await this.settings.settings(tx)).defaultCountry;
      const holidays = new Map<
        string | null,
        Awaited<ReturnType<LeaveSettingsService['holidayMap']>>
      >();
      for (const person of people) {
        const country = person.country ?? fallbackCountry;
        if (!holidays.has(country)) {
          holidays.set(country, await this.settings.holidayMap(tx, country, from, to));
        }
      }
      const scheduleMap = await this.schedules.forEmployees(tx, ids);
      const leave = await tx.leaveRequestDay.findMany({
        where: {
          day: { gte: dateIn(from), lte: dateIn(to) },
          request: { employeeId: { in: ids }, status: 'approved' },
        },
        select: { day: true, request: { select: { employeeId: true } } },
      });
      const onLeave = new Set(leave.map((l) => `${l.request.employeeId}|${dateOut(l.day)}`));

      // Teams of the people (their team events are busy time), then every timed event that could matter.
      const memberships = await tx.teamMember.findMany({
        where: { employeeId: { in: ids } },
        select: { employeeId: true, teamId: true },
      });
      const leads = await tx.team.findMany({
        where: { leadEmployeeId: { in: ids } },
        select: { id: true, leadEmployeeId: true },
      });
      const teamsOf = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
      for (const m of memberships) teamsOf.get(m.employeeId)?.add(m.teamId);
      for (const t of leads) if (t.leadEmployeeId) teamsOf.get(t.leadEmployeeId)?.add(t.id);
      const allTeams = [...new Set([...teamsOf.values()].flatMap((s) => [...s]))];

      const events = await tx.calendarEvent.findMany({
        where: {
          allDay: false,
          startDate: { lte: dateIn(to) },
          OR: [
            { recurrenceFreq: null, endDate: { gte: dateIn(from) } },
            {
              recurrenceFreq: { not: null },
              OR: [
                { recurrenceUntil: null },
                { recurrenceUntil: { gte: dateIn(addDays(from, -31)) } },
              ],
            },
          ],
          AND: [
            {
              OR: [
                { scope: 'company' },
                { scope: 'team', teamId: { in: allTeams } },
                { scope: 'personal', ownerEmployeeId: { in: ids } },
                { scope: 'personal', attendees: { some: { employeeId: { in: ids } } } },
              ],
            },
          ],
        },
        select: {
          scope: true,
          teamId: true,
          ownerEmployeeId: true,
          startDate: true,
          endDate: true,
          startsAt: true,
          endsAt: true,
          recurrenceFreq: true,
          recurrenceInterval: true,
          recurrenceWeekdays: true,
          recurrenceUntil: true,
          recurrenceCount: true,
          exceptions: { select: { originalDate: true } },
          attendees: { select: { employeeId: true, response: true } },
        },
        take: 2000,
      });

      const busy = new Map<string, Map<string, Interval[]>>(ids.map((id) => [id, new Map()]));
      const addBusy = (employeeId: string, date: string, interval: Interval) => {
        const days = busy.get(employeeId)!;
        const list = days.get(date) ?? [];
        list.push(interval);
        days.set(date, list);
      };
      for (const event of events) {
        const start = utcToZoned(event.startsAt!, zone);
        const end = utcToZoned(event.endsAt!, zone);
        const rule = ruleOf(event);
        const cancelled = new Set(event.exceptions.map((e) => dateOut(e.originalDate)));
        const occurrences = rule
          ? occurrencesIn(dateOut(event.startDate), durationDays(event), rule, from, to, cancelled)
          : [{ startDate: dateOut(event.startDate), endDate: dateOut(event.endDate) }];
        const who = ids.filter((id) => {
          if (event.scope === 'company') return true;
          if (event.scope === 'team') return teamsOf.get(id)?.has(event.teamId!) ?? false;
          if (event.ownerEmployeeId === id) return true;
          const guest = event.attendees.find((a) => a.employeeId === id);
          return guest !== undefined && guest.response !== 'declined';
        });
        for (const o of occurrences) {
          const last = daysBetween(o.startDate, o.endDate);
          for (let d = 0; d <= last; d++) {
            const date = addDays(o.startDate, d);
            if (date < from || date > to) continue;
            const interval: Interval = {
              start: d === 0 ? toMinutes(start.time) : 0,
              end: d === last ? toMinutes(end.time) : 24 * 60,
            };
            for (const id of who) addBusy(id, date, interval);
          }
        }
      }

      // Today is only open from now on.
      const now = utcToZoned(new Date(), zone);
      const days: DayAvailability[] = eachDay(from, to).map((date) => ({
        date,
        people: people.map((p) => {
          const country = p.country ?? fallbackCountry;
          const hire = p.hireDate ? dateOut(p.hireDate) : null;
          const end = p.terminationDate ? dateOut(p.terminationDate) : null;
          const available =
            scheduledMinutes(scheduleMap.get(p.id) ?? [], date) > 0 &&
            !holidays.get(country)?.has(date) &&
            !onLeave.has(`${p.id}|${date}`) &&
            (hire === null || date >= hire) &&
            (end === null || date <= end);
          const list = [...(busy.get(p.id)?.get(date) ?? [])];
          if (date < now.date) return { available: false, busy: list };
          if (date === now.date) list.push({ start: 0, end: toMinutes(now.time) });
          return { available, busy: list };
        }),
      }));
      const slots = findSlots(days, body.durationMinutes, { window: FIND_TIME_WINDOW });
      return {
        slots: slots.map((s) => ({
          date: s.date,
          startTime: minutesToTime(s.start),
          endTime: minutesToTime(s.end),
        })),
      };
    });
  }
}
