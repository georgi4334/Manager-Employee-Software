import { attendanceTarget } from './attendance-days.js';
import { WORKDAY_MINUTES } from './capacity.js';
import type { TimeEntry } from './time.js';

export interface WeekChartDay {
  date: string;
  billable: number;
  nonBillable: number;
  total: number;
  /** 8 hours on a weekday, none on a weekend (informational, like the attendance line). */
  target: number;
}

export interface WeekChartProject {
  projectId: string;
  code: string;
  name: string;
  billable: number;
  nonBillable: number;
  total: number;
}

export interface WeekChart {
  days: WeekChartDay[];
  /** Largest first; ties by code. */
  projects: WeekChartProject[];
  billable: number;
  nonBillable: number;
  total: number;
  /** Billable share of the logged time, a whole percent; 0 when nothing is logged. */
  sharePercent: number;
  /** The height of a full column in minutes: whole hours, at least the 8-hour day. */
  scale: number;
}

type ChartEntry = Pick<TimeEntry, 'workDate' | 'minutes' | 'isBillable' | 'project'>;

/**
 * Hours per day of one week split into billable and not billable, plus the same per project.
 * Finished entries only: a running timer has no minutes yet. Entries outside the listed days are ignored.
 */
export function timeWeekChart(week: {
  days: readonly { date: string }[];
  entries: readonly ChartEntry[];
}): WeekChart {
  const days: WeekChartDay[] = week.days.map((d) => ({
    date: d.date,
    billable: 0,
    nonBillable: 0,
    total: 0,
    target: attendanceTarget(d.date),
  }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  const projects = new Map<string, WeekChartProject>();
  for (const entry of week.entries) {
    const day = byDate.get(entry.workDate);
    if (!day || entry.minutes === null || entry.minutes <= 0) continue;
    const key = entry.isBillable ? 'billable' : 'nonBillable';
    day[key] += entry.minutes;
    day.total += entry.minutes;
    let row = projects.get(entry.project.id);
    if (!row) {
      row = {
        projectId: entry.project.id,
        code: entry.project.code,
        name: entry.project.name,
        billable: 0,
        nonBillable: 0,
        total: 0,
      };
      projects.set(entry.project.id, row);
    }
    row[key] += entry.minutes;
    row.total += entry.minutes;
  }
  const billable = days.reduce((sum, d) => sum + d.billable, 0);
  const nonBillable = days.reduce((sum, d) => sum + d.nonBillable, 0);
  const total = billable + nonBillable;
  const tallest = Math.max(0, ...days.map((d) => d.total));
  return {
    days,
    projects: [...projects.values()].sort(
      (a, b) => b.total - a.total || a.code.localeCompare(b.code),
    ),
    billable,
    nonBillable,
    total,
    sharePercent: total > 0 ? Math.round((billable / total) * 100) : 0,
    scale: Math.max(WORKDAY_MINUTES, Math.ceil(tallest / 60) * 60),
  };
}
