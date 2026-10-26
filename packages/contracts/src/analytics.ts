import { z } from 'zod';
import { daysBetween, addDays, type DateString } from './dates.js';
import { dateOnlySchema } from './employees.js';
import { ATTENDANCE_MODES } from './attendance.js';
import { EMPLOYMENT_TYPES } from './employees.js';
import { GOAL_STATUSES } from './goals.js';
import { PROJECT_STATUSES } from './projects.js';
import { SYSTEM_LEAVE_TYPE_KEYS } from './leave.js';
import { weekStartOf } from './time.js';

export const MAX_ANALYTICS_DAYS = 366;
/** Breakdowns of fewer people than this are withheld, so a figure never points at one person (ADR 0024). */
export const MIN_GROUP_SIZE = 5;

export const analyticsQuerySchema = z
  .object({ from: dateOnlySchema, to: dateOnlySchema })
  .refine((v) => v.to >= v.from, { path: ['to'], error: 'end_before_start' })
  .refine((v) => v.to < v.from || daysBetween(v.from, v.to) < MAX_ANALYTICS_DAYS, {
    path: ['to'],
    error: 'too_long',
  });
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/** The value, or `null` when the group is too small to show a breakdown of it. */
export const suppressSmallGroup = <T>(population: number, value: T): T | null =>
  population < MIN_GROUP_SIZE ? null : value;

/** A whole-number percentage; `null` when there is nothing to divide by. */
export const percentOf = (part: number, whole: number): number | null =>
  whole <= 0 ? null : Math.round((part / whole) * 100);

/** The Mondays of every week the period touches (the first one may lie before `from`). */
export function weekStarts(from: DateString, to: DateString): DateString[] {
  if (to < from) return [];
  const result: DateString[] = [];
  for (let day = weekStartOf(from); day <= to; day = addDays(day, 7)) result.push(day);
  return result;
}

/** Minutes per week of the period: weeks without entries are present with 0, entries outside are ignored. */
export function bucketByWeek(
  from: DateString,
  to: DateString,
  entries: readonly { date: DateString; minutes: number }[],
): { weekStart: DateString; minutes: number }[] {
  const weeks = new Map(weekStarts(from, to).map((w) => [w, 0]));
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    const key = weekStartOf(e.date);
    weeks.set(key, (weeks.get(key) ?? 0) + e.minutes);
  }
  return [...weeks].map(([weekStart, minutes]) => ({ weekStart, minutes }));
}

const count = z.number().int().min(0);

export const analyticsSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** Active people the figures are about (inside the caller's scope). */
  population: count,
  people: z.object({
    headcount: count,
    hires: count,
    leavers: count,
    byDepartment: z
      .array(z.object({ id: z.uuid().nullable(), name: z.string().nullable(), count }))
      .nullable(),
    byEmploymentType: z.array(z.object({ type: z.enum(EMPLOYMENT_TYPES), count })).nullable(),
  }),
  absence: z.object({
    /** Approved leave days inside the period. */
    days: z.number().min(0),
    pendingRequests: count,
    daysPerPerson: z.number().min(0).nullable(),
    byType: z
      .array(
        z.object({
          key: z.enum(SYSTEM_LEAVE_TYPE_KEYS).nullable(),
          name: z.string().nullable(),
          days: z.number().min(0),
        }),
      )
      .nullable(),
  }),
  attendance: z.object({
    records: count,
    workedMinutes: count,
    byMode: z.array(z.object({ mode: z.enum(ATTENDANCE_MODES), records: count })).nullable(),
  }),
  time: z.object({
    loggedMinutes: count,
    billablePercent: z.number().min(0).max(100).nullable(),
    approvedPercent: z.number().min(0).max(100).nullable(),
    weeks: z.array(z.object({ weekStart: z.string(), minutes: count })),
    topProjects: z.array(
      z.object({ id: z.uuid(), code: z.string(), name: z.string(), minutes: count }),
    ),
  }),
  projects: z.object({
    byStatus: z.array(z.object({ status: z.enum(PROJECT_STATUSES), count })),
    openTasks: count,
    overdueTasks: count,
    budgetWarning: count,
    budgetOver: count,
  }),
  /** Company-wide sections: only for `analytics.view_company`. */
  company: z
    .object({
      goals: z.object({
        byStatus: z.array(z.object({ status: z.enum(GOAL_STATUSES), count })),
        overdue: count,
      }),
      reviews: z
        .object({
          cycleId: z.uuid(),
          name: z.string(),
          status: z.enum(['open', 'calibration', 'closed']),
          total: count,
          selfSubmitted: count,
          managerSubmitted: count,
          released: count,
        })
        .nullable(),
    })
    .nullable(),
});
export type Analytics = z.infer<typeof analyticsSchema>;
