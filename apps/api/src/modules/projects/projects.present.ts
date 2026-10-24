import {
  overdueDays,
  peakAllocation,
  todayIn,
  type Assignment,
  type Milestone,
} from '@intime/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TenantContext, TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { dateOut } from './projects.shared.js';

/** "Today" in the workspace time zone. */
export async function workspaceToday(tx: TenantTx, context: TenantContext): Promise<string> {
  const tenant = await tx.tenant.findUnique({
    where: { id: context.requireTenantId() },
    select: { defaultTimezone: true },
  });
  return todayIn(tenant?.defaultTimezone ?? 'UTC');
}

type MilestoneRow = Prisma.MilestoneGetPayload<object>;

export const presentMilestone = (row: MilestoneRow, today: string): Milestone => {
  const milestone = {
    dueDate: dateOut(row.dueDate),
    status: row.status as Milestone['status'],
  };
  return {
    id: row.id,
    title: row.title,
    dueDate: milestone.dueDate,
    status: milestone.status,
    doneOn: row.doneOn ? dateOut(row.doneOn) : null,
    overdueDays: overdueDays(milestone, today),
  };
};

export const ASSIGNMENT_SELECT = {
  id: true,
  projectId: true,
  employeeId: true,
  role: true,
  allocationPct: true,
  fromDate: true,
  toDate: true,
  employee: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ProjectAssignmentSelect;
export type AssignmentRow = Prisma.ProjectAssignmentGetPayload<{
  select: typeof ASSIGNMENT_SELECT;
}>;

/** Assignments with the over-allocation flag: what each person is planned for across ALL their projects. */
export async function presentAssignments(
  tx: TenantTx,
  rows: readonly AssignmentRow[],
): Promise<Assignment[]> {
  if (rows.length === 0) return [];
  const people = [...new Set(rows.map((r) => r.employeeId))];
  const planned = await tx.projectAssignment.findMany({
    where: { employeeId: { in: people } },
    select: { employeeId: true, fromDate: true, toDate: true, allocationPct: true },
  });
  const byPerson = new Map<
    string,
    { fromDate: string; toDate: string | null; allocationPct: number }[]
  >();
  for (const p of planned) {
    const list = byPerson.get(p.employeeId) ?? [];
    list.push({
      fromDate: dateOut(p.fromDate),
      toDate: p.toDate ? dateOut(p.toDate) : null,
      allocationPct: p.allocationPct,
    });
    byPerson.set(p.employeeId, list);
  }
  return rows.map((row) => {
    const window = {
      fromDate: dateOut(row.fromDate),
      toDate: row.toDate ? dateOut(row.toDate) : null,
    };
    return {
      id: row.id,
      employee: row.employee,
      role: row.role,
      allocationPct: row.allocationPct,
      fromDate: window.fromDate,
      toDate: window.toDate,
      overAllocated: peakAllocation(byPerson.get(row.employeeId) ?? [], window) > 100,
    };
  });
}
