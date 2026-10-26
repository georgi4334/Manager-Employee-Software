import { Injectable } from '@nestjs/common';
import {
  assignmentMinutes,
  availableMinutes,
  dayStatus,
  eachDay,
  freeMinutes,
  loadLevel,
  overtimeMinutes,
  scheduledMinutes,
  workingMinutes,
  type Capacity,
  type CapacityPerson,
  type CapacityQuery,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { LeaveSettingsService } from '../leave/leave-settings.service.js';
import { ProjectAccess } from '../projects/project-access.service.js';
import { SchedulesService } from '../schedules/schedules.service.js';
import { dateIn, dateOut, escapeLike, notFound } from '../projects/projects.shared.js';

/**
 * Planned versus actual load and availability (docs/adr/0018-capacity.md): computed from staffing, holidays, approved
 * leave and logged time; nothing is stored.
 */
@Injectable()
export class CapacityService {
  constructor(
    private readonly db: TenantDb,
    private readonly authz: AuthorizationService,
    private readonly access: ProjectAccess,
    private readonly settings: LeaveSettingsService,
    private readonly schedules: SchedulesService,
  ) {}

  overview(actor: RequestAuth, query: CapacityQuery): Promise<Capacity> {
    return this.db.tx(async (tx) => {
      const { from, to } = query;
      const dates = eachDay(from, to);
      const range = { gte: dateIn(from), lte: dateIn(to) };
      const projectScope = await this.access.visibleWhere(tx, actor, 'project.view');

      // Who: active people inside the caller's scope, optionally by name or by project.
      const words = (query.q ?? '').split(/\s+/).filter(Boolean).slice(0, 5);
      const people = await tx.employee.findMany({
        where: {
          status: 'active',
          AND: words.map((word) => ({
            OR: [
              { firstName: { contains: escapeLike(word), mode: 'insensitive' as const } },
              { lastName: { contains: escapeLike(word), mode: 'insensitive' as const } },
            ],
          })),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          hireDate: true,
          terminationDate: true,
          country: true,
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      });
      const allowed = await this.authz.allowedEmployees(
        actor,
        'capacity.view',
        people.map((p) => p.id),
      );
      let selected = people.filter((p) => allowed.has(p.id));
      if (query.projectId) {
        const project = await tx.project.findFirst({
          where: { AND: [{ id: query.projectId }, projectScope] },
          select: { id: true },
        });
        if (!project) throw notFound('Project');
        const staffed = new Set(
          (
            await tx.projectAssignment.findMany({
              where: {
                projectId: query.projectId,
                fromDate: { lte: range.lte },
                OR: [{ toDate: null }, { toDate: { gte: range.gte } }],
              },
              select: { employeeId: true },
            })
          ).map((a) => a.employeeId),
        );
        selected = selected.filter((p) => staffed.has(p.id));
      }
      const total = selected.length;
      const page = selected.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
      const ids = page.map((p) => p.id);
      if (ids.length === 0) {
        return { from, to, items: [], total, page: query.page, pageSize: query.pageSize };
      }

      // What: holidays per country, approved leave, staffing and logged time of those people.
      const fallbackCountry = (await this.settings.settings(tx)).defaultCountry;
      const holidays = new Map<
        string | null,
        Awaited<ReturnType<LeaveSettingsService['holidayMap']>>
      >();
      for (const person of page) {
        const country = person.country ?? fallbackCountry;
        if (!holidays.has(country)) {
          holidays.set(country, await this.settings.holidayMap(tx, country, from, to));
        }
      }
      const scheduleMap = await this.schedules.forEmployees(tx, ids);
      const leaveDays = await tx.leaveRequestDay.findMany({
        where: { day: range, request: { employeeId: { in: ids }, status: 'approved' } },
        select: { day: true, fraction: true, request: { select: { employeeId: true } } },
      });
      const leave = new Map<string, number>();
      for (const l of leaveDays) {
        leave.set(`${l.request.employeeId}|${dateOut(l.day)}`, Number(l.fraction));
      }
      const assignments = await tx.projectAssignment.findMany({
        where: {
          employeeId: { in: ids },
          fromDate: { lte: range.lte },
          OR: [{ toDate: null }, { toDate: { gte: range.gte } }],
          project: { status: { not: 'done' } },
        },
        select: {
          employeeId: true,
          projectId: true,
          allocationPct: true,
          fromDate: true,
          toDate: true,
        },
      });
      const entries = await tx.timeEntry.findMany({
        where: { employeeId: { in: ids }, workDate: range, minutes: { not: null } },
        select: { employeeId: true, projectId: true, workDate: true, minutes: true },
      });

      // Project names, only for projects the caller may see.
      const projectIds = [...new Set([...assignments, ...entries].map((r) => r.projectId))];
      const visible = new Map(
        (
          await tx.project.findMany({
            where: { AND: [{ id: { in: projectIds } }, projectScope] },
            select: { id: true, code: true, name: true },
          })
        ).map((p) => [p.id, p]),
      );

      const items: CapacityPerson[] = page.map((person) => {
        const country = person.country ?? fallbackCountry;
        const holidayMap = holidays.get(country);
        const mine = assignments.filter((a) => a.employeeId === person.id);
        const logs = entries.filter((e) => e.employeeId === person.id);
        const perProject = new Map<string | null, { planned: number; logged: number }>();
        const bucket = (projectId: string) => {
          const key = visible.has(projectId) ? projectId : null;
          const found = perProject.get(key) ?? { planned: 0, logged: 0 };
          perProject.set(key, found);
          return found;
        };

        const personSchedules = scheduleMap.get(person.id) ?? [];
        let overtime = 0;
        const days = dates.map((date) => {
          const scheduled = scheduledMinutes(personSchedules, date);
          const working = workingMinutes(date, {
            holiday: holidayMap?.get(date),
            hireDate: person.hireDate ? dateOut(person.hireDate) : null,
            terminationDate: person.terminationDate ? dateOut(person.terminationDate) : null,
            scheduledMinutes: scheduled,
          });
          const leaveFraction = leave.get(`${person.id}|${date}`) ?? 0;
          const available = availableMinutes(working, leaveFraction, scheduled);
          let planned = 0;
          for (const a of mine) {
            if (dateOut(a.fromDate) > date || (a.toDate && dateOut(a.toDate) < date)) continue;
            const minutes = assignmentMinutes(available, a.allocationPct);
            planned += minutes;
            bucket(a.projectId).planned += minutes;
          }
          let logged = 0;
          for (const e of logs) {
            if (dateOut(e.workDate) !== date) continue;
            logged += e.minutes ?? 0;
            bucket(e.projectId).logged += e.minutes ?? 0;
          }
          overtime += overtimeMinutes(logged, available);
          return {
            date,
            availableMinutes: available,
            plannedMinutes: planned,
            loggedMinutes: logged,
            status: dayStatus({ working, leaveFraction, available, planned }),
          };
        });

        const sum = (pick: (d: (typeof days)[number]) => number) =>
          days.reduce((total, d) => total + pick(d), 0);
        const available = sum((d) => d.availableMinutes);
        const planned = sum((d) => d.plannedMinutes);
        return {
          employee: { id: person.id, firstName: person.firstName, lastName: person.lastName },
          availableMinutes: available,
          plannedMinutes: planned,
          loggedMinutes: sum((d) => d.loggedMinutes),
          overtimeMinutes: overtime,
          freeMinutes: freeMinutes(available, planned),
          level: loadLevel(planned, available),
          days,
          projects: [...perProject]
            .map(([id, v]) => ({
              id,
              code: id ? (visible.get(id)?.code ?? null) : null,
              name: id ? (visible.get(id)?.name ?? null) : null,
              plannedMinutes: v.planned,
              loggedMinutes: v.logged,
            }))
            .filter((p) => p.plannedMinutes > 0 || p.loggedMinutes > 0)
            .sort(
              (a, b) =>
                b.plannedMinutes + b.loggedMinutes - (a.plannedMinutes + a.loggedMinutes) ||
                (a.code ?? '￿').localeCompare(b.code ?? '￿'),
            ),
        };
      });
      return { from, to, items, total, page: query.page, pageSize: query.pageSize };
    });
  }
}
