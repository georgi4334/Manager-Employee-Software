import { z } from 'zod';

/** Every widget the dashboard can show, one or more per menu feature (docs/adr/0034-dashboard.md). */
export const DASHBOARD_WIDGETS = [
  'stat_presence',
  'stat_approvals',
  'stat_hours',
  'stat_workload',
  'stat_tasks',
  'attendance',
  'leave',
  'approvals',
  'calendar',
  'projects',
  'tasks',
  'time',
  'capacity',
  'goals',
  'one_on_ones',
  'feedback',
  'skills',
  'reviews',
  'analytics',
  'assistant',
  'retention',
  'roles',
  'employees',
  'organization',
  'notifications',
] as const;
export type DashboardWidget = (typeof DASHBOARD_WIDGETS)[number];

export const MAX_DASHBOARD_WIDGETS = 50;

/** What a workspace shows until an administrator changes it. */
export const DEFAULT_DASHBOARD: readonly DashboardWidget[] = [
  'stat_presence',
  'stat_approvals',
  'stat_hours',
  'stat_workload',
  'attendance',
  'tasks',
  'calendar',
  'approvals',
  'time',
  'projects',
  'goals',
  'notifications',
];

const widgetSchema = z.enum(DASHBOARD_WIDGETS);

export const dashboardLayoutRequestSchema = z
  .object({
    widgets: z.array(widgetSchema).max(MAX_DASHBOARD_WIDGETS),
  })
  .refine((body) => new Set(body.widgets).size === body.widgets.length, {
    path: ['widgets'],
    message: 'duplicate_widget',
  });
export type DashboardLayoutRequest = z.infer<typeof dashboardLayoutRequestSchema>;

export const dashboardLayoutSchema = z.object({
  widgets: z.array(widgetSchema),
  /** True while the workspace uses the built-in default. */
  isDefault: z.boolean(),
  /** Whether the caller may change the layout (computed by the server). */
  canEdit: z.boolean(),
});
export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;

/** Keeps known ids only, each once, in their order (the catalog may lose a widget later). */
export function normalizeLayout(ids: readonly string[]): DashboardWidget[] {
  const known = new Set<string>(DASHBOARD_WIDGETS);
  const seen = new Set<string>();
  const out: DashboardWidget[] = [];
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id as DashboardWidget);
  }
  return out;
}

/** Moves the widget at `index` one place up (-1) or down (+1); out of range changes nothing. */
export function moveWidget<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}
