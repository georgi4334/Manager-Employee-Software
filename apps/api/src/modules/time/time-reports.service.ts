import { Injectable } from '@nestjs/common';
import {
  taskKey,
  type ExportData,
  type ExportQuery,
  type Report,
  type ReportQuery,
  type ReportRow,
} from '@intime/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import type { TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { dateOut, forbidden, notFound } from '../projects/projects.shared.js';

const EXPORT_LIMIT = 50_000;

interface Cell {
  projectId: string;
  employeeId: string;
  total: number;
  billable: number;
  approved: number;
}

const uuids = (ids: readonly string[]) => Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));

/** Hours per project, person and client, budget versus actual, and the approved-hours export (ADR 0016). */
@Injectable()
export class TimeReportsService {
  constructor(
    private readonly db: TenantDb,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  report(actor: RequestAuth, query: ReportQuery): Promise<Report> {
    return this.db.tx(async (tx) => {
      const byPerson = query.groupBy === 'person';
      if (query.groupBy === 'client' && !actor.permissions['client.view']) {
        throw forbidden('Reports per client need permission to see clients');
      }
      if (!byPerson && !actor.permissions['time.report_project']) {
        throw forbidden('No permission for project reports');
      }
      if (byPerson && !actor.permissions['time.view'])
        throw forbidden('No permission to view time');

      // Which projects and people the caller may report on. Person reports need the project scope
      // only when they are narrowed to one project.
      let scopeProjects: string[] | null = null; // null = no restriction on projects
      if (query.projectId || !byPerson) {
        const projectIds = await this.projectScope(tx, actor, 'time.report_project');
        if (query.projectId) {
          if (!projectIds.includes(query.projectId)) throw notFound('Project');
          scopeProjects = [query.projectId];
        } else {
          scopeProjects = projectIds;
        }
      }
      let scopePeople: string[] | null = null;
      if (byPerson) {
        const everyone = (await tx.employee.findMany({ select: { id: true } })).map((e) => e.id);
        scopePeople = [...(await this.authz.allowedEmployees(actor, 'time.view', everyone))];
      }
      if (scopeProjects?.length === 0 || scopePeople?.length === 0) {
        return {
          from: query.from,
          to: query.to,
          groupBy: query.groupBy,
          rows: [],
          totalMinutes: 0,
          billableMinutes: 0,
          approvedMinutes: 0,
        };
      }

      const cells = await this.cells(tx, query.from, query.to, scopeProjects, scopePeople);
      const rows = await this.rows(tx, query.groupBy, cells);
      const sum = (pick: (r: ReportRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
      return {
        from: query.from,
        to: query.to,
        groupBy: query.groupBy,
        rows,
        totalMinutes: sum((r) => r.totalMinutes),
        billableMinutes: sum((r) => r.billableMinutes),
        approvedMinutes: sum((r) => r.approvedMinutes),
      };
    });
  }

  export(actor: RequestAuth, query: ExportQuery): Promise<ExportData> {
    return this.db.tx(async (tx) => {
      const projectIds = await this.projectScope(tx, actor, 'time.export');
      let scope = projectIds;
      if (query.projectId) {
        if (!projectIds.includes(query.projectId)) throw notFound('Project');
        scope = [query.projectId];
      }
      const rows =
        scope.length === 0
          ? []
          : await tx.$queryRaw<
              {
                work_date: Date;
                first_name: string;
                last_name: string;
                code: string;
                name: string;
                number: number | null;
                minutes: number;
                is_billable: boolean;
              }[]
            >(Prisma.sql`
              SELECT e.work_date, emp.first_name, emp.last_name, p.code, p.name, t.number, e.minutes, e.is_billable
              FROM time_entry e
              JOIN timesheet s ON s.tenant_id = e.tenant_id AND s.employee_id = e.employee_id
                AND s.week_start = date_trunc('week', e.work_date)::date AND s.status = 'approved'
              JOIN employee emp ON emp.tenant_id = e.tenant_id AND emp.id = e.employee_id
              JOIN project p ON p.tenant_id = e.tenant_id AND p.id = e.project_id
              LEFT JOIN task t ON t.tenant_id = e.tenant_id AND t.id = e.task_id
              WHERE e.minutes IS NOT NULL
                AND e.work_date BETWEEN ${query.from}::date AND ${query.to}::date
                AND e.project_id IN (${uuids(scope)})
              ORDER BY e.work_date, p.code, emp.last_name, emp.first_name, e.created_at
              LIMIT ${EXPORT_LIMIT}`);
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'time.exported',
        entity: 'time_entry',
        after: {
          from: query.from,
          to: query.to,
          projectId: query.projectId ?? null,
          rows: rows.length,
        },
      });
      return {
        from: query.from,
        to: query.to,
        rows: rows.map((r) => ({
          workDate: dateOut(r.work_date),
          person: `${r.first_name} ${r.last_name}`,
          projectCode: r.code,
          projectName: r.name,
          task: r.number === null ? null : taskKey(r.code, r.number),
          minutes: Number(r.minutes),
          isBillable: r.is_billable,
        })),
      };
    });
  }

  // ----- helpers -------------------------------------------------------------------------------

  /** Projects the caller may report on: all at scope "all", otherwise those led by people inside the scope. */
  private async projectScope(
    tx: TenantTx,
    actor: RequestAuth,
    code: 'time.report_project' | 'time.export',
  ): Promise<string[]> {
    const scope = actor.permissions[code];
    if (!scope) throw forbidden(`Not allowed: ${code}`);
    if (scope === 'all')
      return (await tx.project.findMany({ select: { id: true } })).map((p) => p.id);
    const leaders = (await tx.employee.findMany({ select: { id: true } })).map((e) => e.id);
    const allowed = [...(await this.authz.allowedEmployees(actor, code, leaders))];
    if (allowed.length === 0) return [];
    return (
      await tx.project.findMany({
        where: { leadEmployeeId: { in: allowed } },
        select: { id: true },
      })
    ).map((p) => p.id);
  }

  /** Finished entries of the period, summed per project and person. */
  private async cells(
    tx: TenantTx,
    from: string,
    to: string,
    projects: string[] | null,
    people: string[] | null,
  ): Promise<Cell[]> {
    const rows = await tx.$queryRaw<
      {
        project_id: string;
        employee_id: string;
        total: bigint;
        billable: bigint;
        approved: bigint;
      }[]
    >(Prisma.sql`
      SELECT e.project_id, e.employee_id,
             SUM(e.minutes) AS total,
             SUM(CASE WHEN e.is_billable THEN e.minutes ELSE 0 END) AS billable,
             SUM(CASE WHEN s.status = 'approved' THEN e.minutes ELSE 0 END) AS approved
      FROM time_entry e
      LEFT JOIN timesheet s ON s.tenant_id = e.tenant_id AND s.employee_id = e.employee_id
        AND s.week_start = date_trunc('week', e.work_date)::date
      WHERE e.minutes IS NOT NULL
        AND e.work_date BETWEEN ${from}::date AND ${to}::date
        ${projects ? Prisma.sql`AND e.project_id IN (${uuids(projects)})` : Prisma.empty}
        ${people ? Prisma.sql`AND e.employee_id IN (${uuids(people)})` : Prisma.empty}
      GROUP BY e.project_id, e.employee_id`);
    return rows.map((r) => ({
      projectId: r.project_id,
      employeeId: r.employee_id,
      total: Number(r.total),
      billable: Number(r.billable),
      approved: Number(r.approved),
    }));
  }

  private async rows(
    tx: TenantTx,
    groupBy: ReportQuery['groupBy'],
    cells: Cell[],
  ): Promise<ReportRow[]> {
    const projectIds = [...new Set(cells.map((c) => c.projectId))];
    const projects = await tx.project.findMany({
      where: { id: { in: projectIds } },
      select: {
        id: true,
        code: true,
        name: true,
        budgetHours: true,
        client: { select: { id: true, name: true } },
      },
    });
    const byProject = new Map(projects.map((p) => [p.id, p]));
    const empty = { totalMinutes: 0, billableMinutes: 0, approvedMinutes: 0 };
    const add = (target: typeof empty, c: Cell) => {
      target.totalMinutes += c.total;
      target.billableMinutes += c.billable;
      target.approvedMinutes += c.approved;
    };
    const groups = new Map<string, ReportRow>();

    if (groupBy === 'project') {
      const logged = await tx.$queryRaw<{ project_id: string; total: bigint }[]>(Prisma.sql`
        SELECT project_id, SUM(minutes) AS total FROM time_entry
        WHERE minutes IS NOT NULL ${projectIds.length ? Prisma.sql`AND project_id IN (${uuids(projectIds)})` : Prisma.sql`AND false`}
        GROUP BY project_id`);
      const loggedBy = new Map(logged.map((l) => [l.project_id, Number(l.total)]));
      for (const c of cells) {
        const p = byProject.get(c.projectId)!;
        const row = groups.get(c.projectId) ?? {
          id: p.id,
          label: p.name,
          detail: p.code,
          ...empty,
          budgetMinutes: p.budgetHours === null ? null : Math.round(Number(p.budgetHours) * 60),
          loggedMinutes: loggedBy.get(p.id) ?? 0,
        };
        add(row, c);
        groups.set(c.projectId, row);
      }
    } else if (groupBy === 'client') {
      for (const c of cells) {
        const client = byProject.get(c.projectId)!.client;
        const key = client?.id ?? 'none';
        const row = groups.get(key) ?? {
          id: client?.id ?? null,
          label: client?.name ?? '',
          detail: null,
          ...empty,
          budgetMinutes: null,
          loggedMinutes: null,
        };
        add(row, c);
        groups.set(key, row);
      }
    } else {
      const people = await tx.employee.findMany({
        where: { id: { in: [...new Set(cells.map((c) => c.employeeId))] } },
        select: { id: true, firstName: true, lastName: true },
      });
      const byPerson = new Map(people.map((p) => [p.id, p]));
      for (const c of cells) {
        const p = byPerson.get(c.employeeId)!;
        const row = groups.get(c.employeeId) ?? {
          id: p.id,
          label: `${p.firstName} ${p.lastName}`,
          detail: null,
          ...empty,
          budgetMinutes: null,
          loggedMinutes: null,
        };
        add(row, c);
        groups.set(c.employeeId, row);
      }
    }
    return [...groups.values()].sort(
      (a, b) => b.totalMinutes - a.totalMinutes || a.label.localeCompare(b.label),
    );
  }
}
