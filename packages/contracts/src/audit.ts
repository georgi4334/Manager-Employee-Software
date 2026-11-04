import { z } from 'zod';
import { dateOnlySchema } from './employees.js';
import type { GrantedPermissions, PermissionCode } from './permissions.js';

/**
 * The audit log viewer (docs/adr/0041-audit-log-viewer.md). Every action the API records is listed here under one
 * area; `AuditService.record` only accepts these, so a new action fails typecheck until it has an area (and the web
 * app a text for it).
 */
export const AUDIT_AREAS = {
  workspace: {
    permission: 'admin.tenant.settings',
    actions: [
      'tenant.created',
      'workspace.updated',
      'dashboard.updated',
      'dashboard.reset',
      'ai.workspace_updated',
      'ai.key_set',
      'ai.key_removed',
    ],
  },
  users: {
    permission: 'admin.user.view',
    actions: [
      'user.invited',
      'user.disabled',
      'user.enabled',
      'user.roles_changed',
      'user.role_granted',
    ],
  },
  roles: {
    permission: 'admin.role.view',
    actions: ['role.created', 'role.updated', 'role.deleted', 'role.moved'],
  },
  people: {
    permission: 'employee.update',
    actions: [
      'employee.created',
      'employee.updated',
      'employee.invited',
      'employee.deactivated',
      'employee.reactivated',
      'employee.schedule_set',
      'employee.schedule_removed',
      'org.department_created',
      'org.department_updated',
      'org.department_deleted',
      'org.team_created',
      'org.team_updated',
      'org.team_deleted',
      'org.team_members_changed',
      'org.employee_assigned',
      'org.employee_offboarded',
    ],
  },
  compensation: {
    permission: 'compensation.view',
    actions: ['compensation.set', 'compensation.removed'],
  },
  privacy: {
    permission: 'gdpr.export_employee',
    actions: [
      'privacy.exported',
      'privacy.erased',
      'privacy.retention_updated',
      'privacy.retention_hold_set',
      'privacy.retention_hold_released',
    ],
  },
  leave: {
    permission: 'leave.manage_types_policies',
    actions: [
      'leave.requested',
      'leave.approved',
      'leave.rejected',
      'leave.cancelled',
      'leave.balance_adjusted',
      'leave.holiday_created',
      'leave.holiday_deleted',
      'leave.settings_updated',
      'leave.type_created',
      'leave.type_updated',
    ],
  },
  attendance: {
    permission: 'attendance.correct',
    actions: ['attendance.created', 'attendance.updated', 'attendance.deleted'],
  },
  time: {
    permission: 'timesheet.approve',
    actions: [
      'time.exported',
      'timesheet.submitted',
      'timesheet.approved',
      'timesheet.rejected',
      'timesheet.reopened',
    ],
  },
  projects: {
    permission: 'project.manage',
    actions: [
      'client.created',
      'client.updated',
      'project.created',
      'project.updated',
      'assignment.created',
      'assignment.updated',
      'assignment.deleted',
      'milestone.created',
      'milestone.updated',
      'milestone.deleted',
      'task.created',
      'task.updated',
      'task.deleted',
    ],
  },
  calendar: {
    permission: 'calendar.manage_company_calendar',
    actions: ['calendar.event_created', 'calendar.event_updated', 'calendar.event_deleted'],
  },
  goals: {
    permission: 'goal.manage_company',
    actions: ['goal.created', 'goal.updated', 'goal.deleted', 'goal.key_result_changed'],
  },
  reviews: {
    permission: 'review.manage_cycles',
    actions: [
      'review.cycle_created',
      'review.cycle_updated',
      'review.cycle_deleted',
      'review.competency_added',
      'review.competency_updated',
      'review.competency_removed',
      'review.cycle_status',
      'review.cycle_opened',
      'review.calibrated',
      'review.released',
      'review.reopened',
    ],
  },
  feedback: {
    permission: 'feedback.moderate',
    actions: ['feedback.removed'],
  },
  skills: {
    permission: 'skill.manage_catalog',
    actions: [
      'skill.category_created',
      'skill.category_updated',
      'skill.category_deleted',
      'skill.created',
      'skill.updated',
      'skill.deleted',
    ],
  },
  checklists: {
    permission: 'checklist.manage_templates',
    actions: [
      'checklist.started',
      'checklist.cancelled',
      'checklist_template.created',
      'checklist_template.updated',
      'checklist_template.deleted',
    ],
  },
} as const satisfies Record<string, { permission: PermissionCode; actions: readonly string[] }>;

export type AuditArea = keyof typeof AUDIT_AREAS;
export type AuditAction = (typeof AUDIT_AREAS)[AuditArea]['actions'][number];

export const AUDIT_AREA_KEYS = Object.keys(AUDIT_AREAS) as AuditArea[];
export const AUDIT_ACTIONS: AuditAction[] = AUDIT_AREA_KEYS.flatMap(
  (area) => AUDIT_AREAS[area].actions,
);

const AREA_OF = new Map<string, AuditArea>(
  AUDIT_AREA_KEYS.flatMap((area) => AUDIT_AREAS[area].actions.map((a) => [a, area] as const)),
);

/** The area of a recorded action; null for anything outside the catalog (never shown). */
export function auditAreaOf(action: string): AuditArea | null {
  return AREA_OF.get(action) ?? null;
}

/**
 * The areas a reader may see: `admin.audit_log.view` plus the area's own permission, both at scope `all` (the log is
 * workspace-wide). So people see the history of what they administer: HR without workspace settings never sees those.
 */
export function visibleAuditAreas(permissions: GrantedPermissions): AuditArea[] {
  if (permissions['admin.audit_log.view'] !== 'all') return [];
  return AUDIT_AREA_KEYS.filter((area) => permissions[AUDIT_AREAS[area].permission] === 'all');
}

export const AUDIT_PAGE_SIZE = 50;
const MAX_AUDIT_PAGE_SIZE = 100;

export const auditQuerySchema = z
  .object({
    area: z.enum(AUDIT_AREA_KEYS as [AuditArea, ...AuditArea[]]).optional(),
    /** Workspace-local days, both included. */
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    /** The history of one record (an employee, a role, a project…). */
    entityId: z.uuid().optional(),
    /** What one person did. */
    actorUserId: z.uuid().optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_AUDIT_PAGE_SIZE).default(AUDIT_PAGE_SIZE),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ['to'],
    error: 'end_before_start',
  });
export type AuditQuery = z.infer<typeof auditQuerySchema>;

const auditPersonSchema = z.object({
  /** The account; null for the system (jobs, automatic retention, the setup command). */
  userId: z.uuid().nullable(),
  /** The person's name now; null when the account has no employee record (any more). */
  name: z.string().nullable(),
  employeeId: z.uuid().nullable(),
});

export const auditEntrySchema = z.object({
  id: z.uuid(),
  at: z.string(),
  action: z.string(),
  area: z.enum(AUDIT_AREA_KEYS as [AuditArea, ...AuditArea[]]),
  entity: z.string(),
  entityId: z.uuid().nullable(),
  /** Who did it. */
  actor: auditPersonSchema,
  /** For entries about an employee: who it is about (name now, null once erased or removed). */
  subject: z.object({ name: z.string().nullable() }).nullable(),
  /** What was stored with the entry: ids, field names, scopes and statuses only (ADR 0003). */
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = z.object({
  items: z.array(auditEntrySchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  /** The areas this reader may see (for the filter). */
  areas: z.array(z.enum(AUDIT_AREA_KEYS as [AuditArea, ...AuditArea[]])),
});
export type AuditPage = z.infer<typeof auditPageSchema>;
