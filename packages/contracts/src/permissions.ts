import { PERMISSION_SCOPES, type PermissionScope, type SystemRole } from './roles.js';

/**
 * The permission catalog: the single source of truth for what can be permitted, with which scopes, and what
 * the four system roles get by default. The API, the web app, the tests and docs/permission-matrix.md are all
 * derived from it (docs/adr/0003-roles-and-permissions.md).
 */

export const PERMISSION_MODULES = [
  'employees',
  'organization',
  'attendance',
  'leave',
  'goals',
  'performance',
  'one_on_one',
  'feedback',
  'skills',
  'projects',
  'time',
  'capacity',
  'analytics',
  'calendar',
  'notifications',
  'ai',
  'admin',
  'gdpr',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const PERMISSION_MODULE_LABELS: Record<PermissionModule, string> = {
  employees: 'Employees',
  organization: 'Organization',
  attendance: 'Attendance',
  leave: 'Leave',
  goals: 'Goals',
  performance: 'Performance',
  one_on_one: '1:1 Meetings',
  feedback: 'Feedback',
  skills: 'Skills Matrix',
  projects: 'Projects & Tasks',
  time: 'Time Tracker',
  capacity: 'Capacity',
  analytics: 'Analytics',
  calendar: 'Calendar',
  notifications: 'Notifications',
  ai: 'AI',
  admin: 'Administration',
  gdpr: 'GDPR',
};

export interface PermissionDef {
  /** `<area>.<action>`, stable: stored in the database and used by clients. */
  readonly code: string;
  readonly module: PermissionModule;
  readonly description: string;
  /** Scopes this permission may be granted with. Anything else is rejected. */
  readonly scopes: readonly PermissionScope[];
  /** Default grants of the system roles. A missing role has no access. */
  readonly grants: Partial<Record<SystemRole, PermissionScope>>;
}

const OWN = ['own'] as const;
const ALL = ['all'] as const;
const PEOPLE = PERMISSION_SCOPES;

type Grant = PermissionScope | null;

/** Grants in the order Employee, Manager, HR, Admin (null = no access), like the matrix columns. */
const g = (
  employee: Grant,
  manager: Grant,
  hr: Grant,
  admin: Grant,
): Partial<Record<SystemRole, PermissionScope>> => {
  const grants: Partial<Record<SystemRole, PermissionScope>> = {};
  if (employee) grants.employee = employee;
  if (manager) grants.manager = manager;
  if (hr) grants.hr = hr;
  if (admin) grants.admin = admin;
  return grants;
};

const def = <const T extends PermissionDef>(definition: T): T => definition;

export const PERMISSIONS = [
  // Employees
  def({
    code: 'employee.view_directory',
    module: 'employees',
    description: 'Company directory: name, photo, position, team, work email',
    scopes: ALL,
    grants: g('all', 'all', 'all', 'all'),
  }),
  def({
    code: 'employee.view_profile_full',
    module: 'employees',
    description: 'Full profile: contact details, birth date, contract',
    scopes: PEOPLE,
    grants: g('own', 'team', 'all', 'all'),
  }),
  def({
    code: 'employee.create',
    module: 'employees',
    description: 'Create employees',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'employee.update',
    module: 'employees',
    description: 'Edit employees',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'employee.deactivate',
    module: 'employees',
    description: 'Deactivate employees',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'employee.update_self_basic',
    module: 'employees',
    description: 'Edit own phone, avatar and preferences',
    scopes: OWN,
    grants: g('own', 'own', 'own', 'own'),
  }),
  def({
    code: 'compensation.view',
    module: 'employees',
    description: 'View salary and compensation (module comes later)',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'compensation.manage',
    module: 'employees',
    description: 'Manage salary and compensation (module comes later)',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),

  // Organization
  def({
    code: 'org.view',
    module: 'organization',
    description: 'Organization chart, departments, teams',
    scopes: ALL,
    grants: g('all', 'all', 'all', 'all'),
  }),
  def({
    code: 'org.manage',
    module: 'organization',
    description: 'Manage departments, teams and reporting lines',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),

  // Attendance
  def({
    code: 'attendance.record',
    module: 'attendance',
    description: 'Manual check-in and check-out',
    scopes: OWN,
    grants: g('own', 'own', 'own', 'own'),
  }),
  def({
    code: 'attendance.view',
    module: 'attendance',
    description: 'View attendance records',
    scopes: PEOPLE,
    grants: g('own', 'team', 'all', 'all'),
  }),
  def({
    code: 'attendance.correct',
    module: 'attendance',
    description: "Correct someone's attendance record",
    scopes: PEOPLE,
    grants: g(null, 'team', 'all', 'all'),
  }),
  def({
    code: 'attendance.export',
    module: 'attendance',
    description: 'Export attendance',
    scopes: PEOPLE,
    grants: g(null, 'team', 'all', 'all'),
  }),

  // Leave
  def({
    code: 'leave.request',
    module: 'leave',
    description: 'Request leave',
    scopes: OWN,
    grants: g('own', 'own', 'own', 'own'),
  }),
  def({
    code: 'leave.view',
    module: 'leave',
    description: 'View leave and who is off (managers: team calendar)',
    scopes: PEOPLE,
    grants: g('own', 'team', 'all', 'all'),
  }),
  def({
    code: 'leave.view_balance',
    module: 'leave',
    description: 'View leave balances',
    scopes: PEOPLE,
    grants: g('own', 'team', 'all', 'all'),
  }),
  def({
    code: 'leave.approve',
    module: 'leave',
    description: 'Approve or reject leave requests',
    scopes: PEOPLE,
    grants: g(null, 'reports', 'all', 'all'),
  }),
  def({
    code: 'leave.manage_types_policies',
    module: 'leave',
    description: 'Manage leave types and policies',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'leave.adjust_balance',
    module: 'leave',
    description: 'Adjust leave balances',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'holiday.manage',
    module: 'leave',
    description: 'Manage public holidays',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),

  // Goals
  def({
    code: 'goal.manage_personal',
    module: 'goals',
    description: 'Manage personal goals (managers: also their reports)',
    scopes: PEOPLE,
    grants: g('own', 'reports', 'all', 'all'),
  }),
  def({
    code: 'goal.manage_team',
    module: 'goals',
    description: 'Manage team goals',
    scopes: PEOPLE,
    grants: g(null, 'team', 'all', 'all'),
  }),
  def({
    code: 'goal.manage_company',
    module: 'goals',
    description: 'Manage company goals',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'goal.view',
    module: 'goals',
    description: 'View goals (team and company goals shared with everyone are always visible)',
    scopes: PEOPLE,
    grants: g('own', 'team', 'all', 'all'),
  }),

  // Performance
  def({
    code: 'review.write_self',
    module: 'performance',
    description: 'Write own self-review',
    scopes: OWN,
    grants: g('own', 'own', 'own', 'own'),
  }),
  def({
    code: 'review.write_for_report',
    module: 'performance',
    description: 'Write reviews for reports',
    scopes: PEOPLE,
    grants: g(null, 'reports', 'all', 'all'),
  }),
  def({
    code: 'review.view',
    module: 'performance',
    description: 'View reviews (employees: own, after release)',
    scopes: PEOPLE,
    grants: g('own', 'reports', 'all', 'all'),
  }),
  def({
    code: 'review.manage_cycles',
    module: 'performance',
    description: 'Manage review cycles',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'review.calibrate',
    module: 'performance',
    description: 'Calibrate ratings',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),

  // 1:1 meetings. Nobody (not even HR/Admin) may read other people's 1:1 notes: no permission exists for it.
  def({
    code: 'one_on_one.manage',
    module: 'one_on_one',
    description: 'Run 1:1 meetings as a participant (private notes stay between the two)',
    scopes: PEOPLE,
    grants: g('own', 'reports', 'reports', 'reports'),
  }),

  // Feedback
  def({
    code: 'feedback.give',
    module: 'feedback',
    description: 'Give feedback to any colleague',
    scopes: ALL,
    grants: g('all', 'all', 'all', 'all'),
  }),
  def({
    code: 'feedback.view_received',
    module: 'feedback',
    description: 'View received feedback (managers and HR: only what was shared with the manager)',
    scopes: PEOPLE,
    grants: g('own', 'reports', 'all', null),
  }),
  def({
    code: 'feedback.moderate',
    module: 'feedback',
    description: 'Decide on feedback that a recipient reported (keep or remove it)',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),

  // Skills
  def({
    code: 'skill.view',
    module: 'skills',
    description: 'View skills',
    scopes: PEOPLE,
    grants: g('own', 'team', 'all', 'all'),
  }),
  def({
    code: 'skill.update',
    module: 'skills',
    description: 'Update skill levels',
    scopes: PEOPLE,
    grants: g('own', 'team', 'all', 'all'),
  }),
  def({
    code: 'skill.manage_catalog',
    module: 'skills',
    description: 'Manage the skill catalog',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),

  // Projects, clients, tasks
  def({
    code: 'project.view',
    module: 'projects',
    description: 'View projects (own = projects I am assigned to)',
    scopes: PEOPLE,
    grants: g('own', 'team', 'all', 'all'),
  }),
  def({
    code: 'project.manage',
    module: 'projects',
    description: 'Manage projects (own = projects I lead)',
    scopes: PEOPLE,
    grants: g(null, 'own', 'all', 'all'),
  }),
  def({
    code: 'assignment.manage',
    module: 'projects',
    description: 'Assign people to projects (own = projects I lead)',
    scopes: PEOPLE,
    grants: g(null, 'own', 'all', 'all'),
  }),
  def({
    code: 'client.view',
    module: 'projects',
    description: 'View clients',
    scopes: ALL,
    grants: g(null, 'all', 'all', 'all'),
  }),
  def({
    code: 'client.manage',
    module: 'projects',
    description: 'Manage clients',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'task.view',
    module: 'projects',
    description: 'View tasks (own = tasks assigned to me or on my projects)',
    scopes: PEOPLE,
    grants: g('own', 'team', 'all', 'all'),
  }),
  def({
    code: 'task.manage',
    module: 'projects',
    description: 'Manage tasks (employees: only the status of their own tasks)',
    scopes: PEOPLE,
    grants: g('own', 'own', 'all', 'all'),
  }),

  // Time tracker
  def({
    code: 'time.log',
    module: 'time',
    description: 'Log time with the timer or manual entries',
    scopes: OWN,
    grants: g('own', 'own', 'own', 'own'),
  }),
  def({
    code: 'time.view',
    module: 'time',
    description: 'View logged time',
    scopes: PEOPLE,
    grants: g('own', 'team', 'all', 'all'),
  }),
  def({
    code: 'timesheet.submit',
    module: 'time',
    description: 'Submit own timesheet',
    scopes: OWN,
    grants: g('own', 'own', 'own', 'own'),
  }),
  def({
    code: 'timesheet.approve',
    module: 'time',
    description: 'Approve timesheets',
    scopes: PEOPLE,
    grants: g(null, 'reports', 'all', 'all'),
  }),
  def({
    code: 'timesheet.reopen',
    module: 'time',
    description: 'Reopen approved timesheets',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'time.report_project',
    module: 'time',
    description: 'Project hours and budget reports (own = projects I lead)',
    scopes: PEOPLE,
    grants: g(null, 'own', 'all', 'all'),
  }),
  def({
    code: 'time.export',
    module: 'time',
    description: 'Export approved hours as CSV (own = projects I lead)',
    scopes: PEOPLE,
    grants: g(null, 'own', 'all', 'all'),
  }),

  // Capacity & analytics
  def({
    code: 'capacity.view',
    module: 'capacity',
    description: 'View workload and availability',
    scopes: PEOPLE,
    grants: g('own', 'team', 'all', 'all'),
  }),
  def({
    code: 'analytics.view_team',
    module: 'analytics',
    description: 'Team analytics',
    scopes: PEOPLE,
    grants: g(null, 'team', 'all', 'all'),
  }),
  def({
    code: 'analytics.view_company',
    module: 'analytics',
    description: 'Company-wide analytics',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),

  // Calendar
  def({
    code: 'calendar.manage_own',
    module: 'calendar',
    description: 'Manage own calendars and events',
    scopes: OWN,
    grants: g('own', 'own', 'own', 'own'),
  }),
  def({
    code: 'calendar.manage_team_calendars',
    module: 'calendar',
    description: 'Manage team calendars',
    scopes: PEOPLE,
    grants: g(null, 'team', 'all', 'all'),
  }),
  def({
    code: 'calendar.manage_company_calendar',
    module: 'calendar',
    description: 'Manage the company calendar',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'calendar.view_free_busy',
    module: 'calendar',
    description: 'See when colleagues are free or busy',
    scopes: ALL,
    grants: g('all', 'all', 'all', 'all'),
  }),

  // Notifications
  def({
    code: 'notification.manage_own_prefs',
    module: 'notifications',
    description: 'Manage own notification preferences',
    scopes: OWN,
    grants: g('own', 'own', 'own', 'own'),
  }),
  def({
    code: 'notification.manage_tenant_defaults',
    module: 'notifications',
    description: 'Set workspace notification defaults',
    scopes: ALL,
    grants: g(null, null, null, 'all'),
  }),

  // AI
  def({
    code: 'ai.use',
    module: 'ai',
    description: 'Use the AI assistant',
    scopes: OWN,
    grants: g('own', 'own', 'own', 'own'),
  }),
  def({
    code: 'ai.manage_own_key',
    module: 'ai',
    description: 'Manage own AI provider key',
    scopes: OWN,
    grants: g('own', 'own', 'own', 'own'),
  }),
  def({
    code: 'ai.manage_tenant_key',
    module: 'ai',
    description: 'Manage the workspace AI provider key',
    scopes: ALL,
    grants: g(null, null, null, 'all'),
  }),
  def({
    code: 'ai.toggle_tenant',
    module: 'ai',
    description: 'Switch AI on or off for the workspace',
    scopes: ALL,
    grants: g(null, null, null, 'all'),
  }),

  // Administration
  def({
    code: 'admin.user.view',
    module: 'admin',
    description: 'List user accounts and their roles',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'admin.user.invite',
    module: 'admin',
    description: 'Invite users (roles beyond Employee also need admin.role.assign)',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'admin.user.disable',
    module: 'admin',
    description: 'Disable and re-enable user accounts',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'admin.role.view',
    module: 'admin',
    description: 'List roles',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'admin.role.assign',
    module: 'admin',
    description: 'Assign roles to users',
    scopes: ALL,
    grants: g(null, null, null, 'all'),
  }),
  def({
    code: 'admin.role.manage',
    module: 'admin',
    description: 'Create and edit roles (editor comes later)',
    scopes: ALL,
    grants: g(null, null, null, 'all'),
  }),
  def({
    code: 'admin.tenant.settings',
    module: 'admin',
    description: 'Workspace settings',
    scopes: ALL,
    grants: g(null, null, null, 'all'),
  }),
  def({
    code: 'admin.audit_log.view',
    module: 'admin',
    description: 'View the audit log (HR sees HR-related events only)',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),

  // GDPR
  def({
    code: 'gdpr.export_own',
    module: 'gdpr',
    description: 'Export own data',
    scopes: OWN,
    grants: g('own', 'own', 'own', 'own'),
  }),
  def({
    code: 'gdpr.export_employee',
    module: 'gdpr',
    description: "Export an employee's data (subject access request)",
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'gdpr.erase_employee',
    module: 'gdpr',
    description: 'Erase or anonymize an employee',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
  def({
    code: 'gdpr.manage_retention',
    module: 'gdpr',
    description: 'Manage data retention',
    scopes: ALL,
    grants: g(null, null, 'all', 'all'),
  }),
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

export const PERMISSION_CODES = PERMISSIONS.map((p) => p.code) as readonly PermissionCode[];

const BY_CODE: ReadonlyMap<string, PermissionDef> = new Map(PERMISSIONS.map((p) => [p.code, p]));

export function isPermissionCode(value: unknown): value is PermissionCode {
  return typeof value === 'string' && BY_CODE.has(value);
}

export function getPermission(code: PermissionCode): PermissionDef {
  return BY_CODE.get(code) as PermissionDef;
}

/** A grant is valid when the code exists and the scope is one the permission allows. */
export function isValidGrant(code: unknown, scope: unknown): code is PermissionCode {
  if (!isPermissionCode(code)) return false;
  return (getPermission(code).scopes as readonly unknown[]).includes(scope);
}

/** Effective permissions of a user: the widest scope per permission. */
export type GrantedPermissions = Partial<Record<PermissionCode, PermissionScope>>;

// ----- Scopes -----------------------------------------------------------------------------------

const SCOPE_RANK: Record<PermissionScope, number> = {
  own: 0,
  reports: 1,
  team: 2,
  department: 3,
  all: 4,
};

export function widerScope(a: PermissionScope, b: PermissionScope): PermissionScope {
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

/** How the owner of a record relates to the person asking. */
export const RELATIONS = [
  'self',
  'direct_report',
  'subordinate',
  'same_department',
  'other',
] as const;
export type Relation = (typeof RELATIONS)[number];

const COVERS: Record<PermissionScope, readonly Relation[]> = {
  own: ['self'],
  reports: ['self', 'direct_report'],
  team: ['self', 'direct_report', 'subordinate'],
  department: ['self', 'direct_report', 'subordinate', 'same_department'],
  all: RELATIONS,
};

/** Does a grant with this scope reach a record whose owner stands in this relation to the actor? */
export function scopeCovers(scope: PermissionScope, relation: Relation): boolean {
  return COVERS[scope].includes(relation);
}

/** Merges grants of several roles, keeping the widest scope per permission and dropping invalid ones. */
export function mergeGrants(
  grantLists: Iterable<Iterable<{ code: string; scope: string }>>,
): GrantedPermissions {
  const merged: GrantedPermissions = {};
  for (const grants of grantLists) {
    for (const { code, scope } of grants) {
      if (!isValidGrant(code, scope)) continue;
      const scopeValue = scope as PermissionScope;
      const current = merged[code];
      merged[code] = current ? widerScope(current, scopeValue) : scopeValue;
    }
  }
  return merged;
}

/** Default grants of a system role, straight from the catalog. */
export function systemRoleGrants(
  role: SystemRole,
): { code: PermissionCode; scope: PermissionScope }[] {
  return PERMISSIONS.flatMap((permission) => {
    const scope = (permission.grants as Partial<Record<SystemRole, PermissionScope>>)[role];
    return scope ? [{ code: permission.code, scope }] : [];
  });
}

export const SYSTEM_ROLE_LABELS: Record<SystemRole, string> = {
  admin: 'Admin',
  hr: 'HR',
  manager: 'Manager',
  employee: 'Employee',
};

// ----- Checks for clients (cosmetic; the server decides) ----------------------------------------

/** Does the user hold the permission, optionally at least with the given scope? */
export function hasPermission(
  granted: GrantedPermissions | undefined,
  code: PermissionCode,
  atLeast: PermissionScope = 'own',
): boolean {
  const scope = granted?.[code];
  return scope !== undefined && SCOPE_RANK[scope] >= SCOPE_RANK[atLeast];
}

// ----- Documentation ----------------------------------------------------------------------------

export const MATRIX_START =
  '<!-- permissions:start (generated by `pnpm --filter @intime/contracts docs:permissions`; do not edit) -->';
export const MATRIX_END = '<!-- permissions:end -->';

/** The permission matrix as a Markdown table, in catalog order. */
export function renderPermissionMatrix(): string {
  const cell = (scope: PermissionScope | undefined) => scope ?? '—';
  const rows = [
    '| Module | Permission | What it allows | Employee | Manager | HR | Admin |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  let previousModule: PermissionModule | undefined;
  for (const permission of PERMISSIONS) {
    const grants = permission.grants as Partial<Record<SystemRole, PermissionScope>>;
    const moduleCell =
      permission.module === previousModule
        ? ''
        : `**${PERMISSION_MODULE_LABELS[permission.module]}**`;
    previousModule = permission.module;
    rows.push(
      `| ${moduleCell} | \`${permission.code}\` | ${permission.description} | ${cell(grants.employee)} | ${cell(grants.manager)} | ${cell(grants.hr)} | ${cell(grants.admin)} |`,
    );
  }
  return rows.join('\n');
}
