import { z } from 'zod';
import { daysBetween } from './dates.js';
import { dateOnlySchema } from './employees.js';

export const REPORT_GROUPS = ['project', 'person', 'client'] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];
export const MAX_REPORT_DAYS = 366;
/** A project is "at risk of its budget" from this share of the budget on. */
export const BUDGET_WARNING_PERCENT = 80;

const period = z
  .object({ from: dateOnlySchema, to: dateOnlySchema, projectId: z.uuid().optional() })
  .refine((v) => v.to >= v.from, { path: ['to'], error: 'end_before_start' })
  .refine((v) => v.to < v.from || daysBetween(v.from, v.to) < MAX_REPORT_DAYS, {
    path: ['to'],
    error: 'too_long',
  });

export const reportQuerySchema = period.and(z.object({ groupBy: z.enum(REPORT_GROUPS) }));
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export const exportQuerySchema = period;
export type ExportQuery = z.infer<typeof exportQuerySchema>;

export const reportRowSchema = z.object({
  /** Project, person or client id; null for time on projects without a client. */
  id: z.uuid().nullable(),
  label: z.string(),
  /** The project code, for project rows. */
  detail: z.string().nullable(),
  totalMinutes: z.number().int(),
  billableMinutes: z.number().int(),
  approvedMinutes: z.number().int(),
  /** Project rows only: the budget, and everything ever logged on the project. */
  budgetMinutes: z.number().int().nullable(),
  loggedMinutes: z.number().int().nullable(),
});
export type ReportRow = z.infer<typeof reportRowSchema>;

export const reportSchema = z.object({
  from: z.string(),
  to: z.string(),
  groupBy: z.enum(REPORT_GROUPS),
  rows: z.array(reportRowSchema),
  totalMinutes: z.number().int(),
  billableMinutes: z.number().int(),
  approvedMinutes: z.number().int(),
});
export type Report = z.infer<typeof reportSchema>;

export const exportRowSchema = z.object({
  workDate: z.string(),
  person: z.string(),
  projectCode: z.string(),
  projectName: z.string(),
  task: z.string().nullable(),
  minutes: z.number().int(),
  isBillable: z.boolean(),
});
export type ExportRow = z.infer<typeof exportRowSchema>;

export const exportSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(exportRowSchema),
});
export type ExportData = z.infer<typeof exportSchema>;

export type BudgetLevel = 'ok' | 'warning' | 'over';

/** How much of its budget a project has used. No budget (or an empty one) has no usage. */
export function budgetUsage(
  loggedMinutes: number,
  budgetMinutes: number | null,
): { percent: number; level: BudgetLevel } | null {
  if (budgetMinutes === null || budgetMinutes <= 0) return null;
  const percent = Math.round((loggedMinutes / budgetMinutes) * 100);
  const exact = loggedMinutes / budgetMinutes;
  const level: BudgetLevel =
    exact > 1 ? 'over' : exact >= BUDGET_WARNING_PERCENT / 100 ? 'warning' : 'ok';
  return { percent, level };
}

const csvCell = (value: string): string => {
  // A spreadsheet runs a cell that starts like a formula: make it plain text.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const TIME_EXPORT_HEADER = [
  'date',
  'person',
  'project_code',
  'project_name',
  'task',
  'hours',
  'billable',
] as const;

/** The approved-hours file: comma separated, UTF-8, one line per entry, decimal hours with a dot. */
export function timeExportCsv(rows: readonly ExportRow[]): string {
  const lines = rows.map((r) =>
    [
      r.workDate,
      r.person,
      r.projectCode,
      r.projectName,
      r.task ?? '',
      (Math.round((r.minutes / 60) * 100) / 100).toFixed(2),
      r.isBillable ? 'yes' : 'no',
    ]
      .map(csvCell)
      .join(','),
  );
  return [TIME_EXPORT_HEADER.join(','), ...lines].join('\r\n') + '\r\n';
}
