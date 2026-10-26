import { Injectable } from '@nestjs/common';
import {
  ATTENDANCE_MODES,
  EMPLOYMENT_TYPES,
  GOAL_STATUSES,
  PROJECT_STATUSES,
  bucketByWeek,
  budgetUsage,
  percentOf,
  suppressSmallGroup,
  type Analytics,
  type AnalyticsQuery,
  type AttendanceMode,
  type EmploymentType,
  type SystemLeaveTypeKey,
} from '@intime/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { TenantContext } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { workspaceToday } from '../projects/projects.present.js';
import { ProjectAccess } from '../projects/project-access.service.js';
import { dateIn, dateOut } from '../projects/projects.shared.js';

const TOP_PROJECTS = 5;
const uuids = (ids: readonly string[]) => Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
const oneDecimal = (value: number) => Math.round(value * 10) / 10;

/**
 * The management view (docs/adr/0024-analytics.md): counts and sums over what already exists, for the people
 * inside the caller's scope. Nothing is stored and no row about a person leaves this service.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
    private readonly access: ProjectAccess,
  ) {}

  overview(actor: RequestAuth, query: AnalyticsQuery): Promise<Analytics> {
    return this.db.tx(async (tx) => {
      const { from, to } = query;
      const range = { gte: dateIn(from), lte: dateIn(to) };

      // Who: everybody inside the scope. Figures about the period include people who left during it;
      // the headcount and the breakdowns are about the active ones.
      const everyone = await tx.employee.findMany({
        select: {
          id: true,
          status: true,
          departmentId: true,
          employmentType: true,
          hireDate: true,
          terminationDate: true,
        },
      });
      const allowed = await this.authz.allowedEmployees(
        actor,
        'analytics.view_team',
        everyone.map((e) => e.id),
      );
      const scoped = everyone.filter((e) => allowed.has(e.id));
      const active = scoped.filter((e) => e.status === 'active');
      const population = active.length;
      const ids = scoped.map((e) => e.id);
      const inRange = (d: Date | null) => d !== null && d >= range.gte && d <= range.lte;

      // People
      const departments = new Map(
        (await tx.department.findMany({ select: { id: true, name: true } })).map((d) => [
          d.id,
          d.name,
        ]),
      );
      const byDepartment = new Map<string | null, number>();
      const byType = new Map<EmploymentType, number>();
      for (const e of active) {
        const key = e.departmentId && departments.has(e.departmentId) ? e.departmentId : null;
        byDepartment.set(key, (byDepartment.get(key) ?? 0) + 1);
        const type = e.employmentType as EmploymentType;
        byType.set(type, (byType.get(type) ?? 0) + 1);
      }
      const people: Analytics['people'] = {
        headcount: population,
        hires: scoped.filter((e) => inRange(e.hireDate)).length,
        leavers: scoped.filter((e) => inRange(e.terminationDate)).length,
        byDepartment: suppressSmallGroup(
          population,
          [...byDepartment]
            .map(([id, count]) => ({ id, name: id ? (departments.get(id) ?? null) : null, count }))
            .sort((a, b) => b.count - a.count || (a.name ?? '').localeCompare(b.name ?? '')),
        ),
        byEmploymentType: suppressSmallGroup(
          population,
          EMPLOYMENT_TYPES.filter((t) => byType.has(t)).map((type) => ({
            type,
            count: byType.get(type) ?? 0,
          })),
        ),
      };

      // Absence
      const leaveDays = ids.length
        ? await tx.leaveRequestDay.findMany({
            where: { day: range, request: { employeeId: { in: ids }, status: 'approved' } },
            select: {
              fraction: true,
              request: { select: { leaveType: { select: { id: true, key: true, name: true } } } },
            },
          })
        : [];
      const leaveByType = new Map<
        string,
        { key: SystemLeaveTypeKey | null; name: string | null; days: number }
      >();
      let leaveTotal = 0;
      for (const l of leaveDays) {
        const type = l.request.leaveType;
        // System types carry one of the fixed keys; custom types have none (their own name is shown).
        const key = type.key as SystemLeaveTypeKey | null;
        const row = leaveByType.get(type.id) ?? { key, name: type.name, days: 0 };
        row.days += Number(l.fraction);
        leaveByType.set(type.id, row);
        leaveTotal += Number(l.fraction);
      }
      const pendingRequests = ids.length
        ? await tx.leaveRequest.count({ where: { employeeId: { in: ids }, status: 'pending' } })
        : 0;
      const absence: Analytics['absence'] = {
        days: oneDecimal(leaveTotal),
        pendingRequests,
        daysPerPerson: population > 0 ? oneDecimal(leaveTotal / population) : null,
        byType: suppressSmallGroup(
          population,
          [...leaveByType.values()]
            .map((r) => ({ ...r, days: oneDecimal(r.days) }))
            .sort(
              (a, b) =>
                b.days - a.days || (a.key ?? a.name ?? '').localeCompare(b.key ?? b.name ?? ''),
            ),
        ),
      };

      // Attendance (finished records only)
      const attendanceRows = ids.length
        ? await tx.$queryRaw<{ mode: string; records: number; minutes: number }[]>(Prisma.sql`
            SELECT mode, count(*)::int AS records,
                   COALESCE(sum(extract(epoch FROM (check_out_at - check_in_at)) / 60), 0)::float8 AS minutes
            FROM attendance_record
            WHERE work_date BETWEEN ${from}::date AND ${to}::date
              AND check_out_at IS NOT NULL
              AND employee_id IN (${uuids(ids)})
            GROUP BY mode`)
        : [];
      const attendance: Analytics['attendance'] = {
        records: attendanceRows.reduce((s, r) => s + r.records, 0),
        workedMinutes: Math.round(attendanceRows.reduce((s, r) => s + r.minutes, 0)),
        byMode: suppressSmallGroup(
          population,
          ATTENDANCE_MODES.map((mode) => ({
            mode: mode as AttendanceMode,
            records: attendanceRows.find((r) => r.mode === mode)?.records ?? 0,
          })).filter((r) => r.records > 0),
        ),
      };

      // Time: finished entries, with the share of approved timesheets
      const entries = ids.length
        ? await tx.$queryRaw<
            {
              work_date: Date;
              project_id: string;
              minutes: number;
              billable: number;
              approved: number;
            }[]
          >(Prisma.sql`
            SELECT e.work_date, e.project_id, sum(e.minutes)::int AS minutes,
                   sum(CASE WHEN e.is_billable THEN e.minutes ELSE 0 END)::int AS billable,
                   sum(CASE WHEN s.id IS NOT NULL THEN e.minutes ELSE 0 END)::int AS approved
            FROM time_entry e
            LEFT JOIN timesheet s ON s.tenant_id = e.tenant_id AND s.employee_id = e.employee_id
              AND s.week_start = date_trunc('week', e.work_date)::date AND s.status = 'approved'
            WHERE e.minutes IS NOT NULL
              AND e.work_date BETWEEN ${from}::date AND ${to}::date
              AND e.employee_id IN (${uuids(ids)})
            GROUP BY e.work_date, e.project_id`)
        : [];
      const sumOf = (pick: (r: (typeof entries)[number]) => number) =>
        entries.reduce((s, r) => s + pick(r), 0);
      const logged = sumOf((r) => r.minutes);

      const projectWhere = await this.access.visibleWhere(tx, actor, 'project.view');
      const visibleProjects = await tx.project.findMany({
        where: projectWhere,
        select: { id: true, code: true, name: true, status: true, budgetHours: true },
      });
      const visible = new Map(visibleProjects.map((p) => [p.id, p]));
      const perProject = new Map<string, number>();
      for (const r of entries) {
        if (visible.has(r.project_id)) {
          perProject.set(r.project_id, (perProject.get(r.project_id) ?? 0) + r.minutes);
        }
      }
      const time: Analytics['time'] = {
        loggedMinutes: logged,
        billablePercent: percentOf(
          sumOf((r) => r.billable),
          logged,
        ),
        approvedPercent: percentOf(
          sumOf((r) => r.approved),
          logged,
        ),
        weeks: bucketByWeek(
          from,
          to,
          entries.map((r) => ({ date: dateOut(r.work_date), minutes: r.minutes })),
        ),
        topProjects: [...perProject]
          .map(([id, minutes]) => ({
            id,
            code: visible.get(id)?.code ?? '',
            name: visible.get(id)?.name ?? '',
            minutes,
          }))
          .sort((a, b) => b.minutes - a.minutes || a.code.localeCompare(b.code))
          .slice(0, TOP_PROJECTS),
      };

      // Projects and tasks the caller may see
      const today = await workspaceToday(tx, this.context);
      const taskProjects = await this.access.visibleWhere(tx, actor, 'task.view');
      const taskWhere = {
        project: { AND: [taskProjects] },
        status: { not: 'done' },
      } satisfies Prisma.TaskWhereInput;
      const [openTasks, overdueTasks] = await Promise.all([
        tx.task.count({ where: taskWhere }),
        tx.task.count({ where: { ...taskWhere, dueDate: { lt: dateIn(today) } } }),
      ]);
      const budgeted = visibleProjects.filter(
        (p) => p.budgetHours !== null && (p.status === 'active' || p.status === 'paused'),
      );
      const budgetMinutes = new Map<string, number>();
      if (budgeted.length) {
        const sums = await tx.timeEntry.groupBy({
          by: ['projectId'],
          where: { projectId: { in: budgeted.map((p) => p.id) }, minutes: { not: null } },
          _sum: { minutes: true },
        });
        for (const s of sums) budgetMinutes.set(s.projectId, s._sum.minutes ?? 0);
      }
      const levels = budgeted.map(
        (p) =>
          budgetUsage(budgetMinutes.get(p.id) ?? 0, Math.round(Number(p.budgetHours) * 60))?.level,
      );
      const projects: Analytics['projects'] = {
        byStatus: PROJECT_STATUSES.map((status) => ({
          status,
          count: visibleProjects.filter((p) => p.status === status).length,
        })),
        openTasks,
        overdueTasks,
        budgetWarning: levels.filter((l) => l === 'warning').length,
        budgetOver: levels.filter((l) => l === 'over').length,
      };

      return {
        from,
        to,
        population,
        people,
        absence,
        attendance,
        time,
        projects,
        company: actor.permissions['analytics.view_company'] ? await this.company(tx, today) : null,
      };
    });
  }

  /** Goals and the newest review cycle across the workspace (counts only). */
  private async company(
    tx: Parameters<Parameters<TenantDb['tx']>[0]>[0],
    today: string,
  ): Promise<NonNullable<Analytics['company']>> {
    const goals = await tx.goal.groupBy({ by: ['status'], _count: { _all: true } });
    const overdue = await tx.goal.count({
      where: { status: { in: ['draft', 'active'] }, dueDate: { lt: dateIn(today) } },
    });
    const cycle = await tx.reviewCycle.findFirst({
      where: { status: { not: 'draft' } },
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, name: true, status: true },
    });
    let reviews: NonNullable<Analytics['company']>['reviews'] = null;
    if (cycle) {
      const [total, selfSubmitted, managerSubmitted, released] = await Promise.all([
        tx.review.count({ where: { cycleId: cycle.id } }),
        tx.review.count({ where: { cycleId: cycle.id, selfSubmittedAt: { not: null } } }),
        tx.review.count({ where: { cycleId: cycle.id, managerSubmittedAt: { not: null } } }),
        tx.review.count({ where: { cycleId: cycle.id, releasedAt: { not: null } } }),
      ]);
      reviews = {
        cycleId: cycle.id,
        name: cycle.name,
        status: cycle.status as 'open' | 'calibration' | 'closed',
        total,
        selfSubmitted,
        managerSubmitted,
        released,
      };
    }
    return {
      goals: {
        byStatus: GOAL_STATUSES.map((status) => ({
          status,
          count: goals.find((g) => g.status === status)?._count._all ?? 0,
        })),
        overdue,
      },
      reviews,
    };
  }
}
