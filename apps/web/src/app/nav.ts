import {
  CalendarDays,
  CalendarOff,
  Briefcase,
  Clock,
  Gauge,
  Target,
  MessagesSquare,
  MessageSquareText,
  Award,
  ClipboardCheck,
  ChartColumn,
  Sparkles,
  Archive,
  ShieldCheck,
  ListChecks,
  Timer,
  LayoutDashboard,
  Network,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type navMessages from '@/i18n/locales/en/nav.json';
import { userHasPermission, type PermissionRequirement } from '@/features/auth/permissions';
import type { GrantedPermissions } from '@intime/contracts';

export interface NavItem {
  path: string;
  /** Key in the `nav` translation namespace. */
  labelKey: keyof typeof navMessages;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar; the rest live under "More". */
  primary: boolean;
  /** Who sees this entry (any one of the permissions is enough). Everyone, when omitted. */
  permission?: PermissionRequirement;
  /** The menu group it is listed under (docs/adr/0037-navigation-groups.md). */
  group: NavGroup;
}

/** Menu groups in order; `top` has no heading, `admin` sits apart at the bottom. */
export const NAV_GROUPS = [
  'top',
  'workday',
  'work',
  'people',
  'growth',
  'insights',
  'admin',
] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export const GROUP_LABEL: Record<Exclude<NavGroup, 'top'>, keyof typeof navMessages> = {
  workday: 'groupWorkday',
  work: 'groupWork',
  people: 'groupPeople',
  growth: 'groupGrowth',
  insights: 'groupInsights',
  admin: 'groupAdmin',
};

export const NAV_ITEMS: NavItem[] = [
  { path: '/', labelKey: 'dashboard', icon: LayoutDashboard, primary: true, group: 'top' },
  {
    path: '/assistant',
    labelKey: 'assistant',
    icon: Sparkles,
    primary: false,
    permission: 'ai.use',
    group: 'top',
  },
  {
    path: '/attendance',
    labelKey: 'attendance',
    icon: Clock,
    primary: true,
    permission: ['attendance.record', 'attendance.view'],
    group: 'workday',
  },
  {
    path: '/leave',
    labelKey: 'leave',
    icon: CalendarOff,
    primary: true,
    permission: ['leave.request', 'leave.view'],
    group: 'workday',
  },
  {
    path: '/calendar',
    labelKey: 'calendar',
    icon: CalendarDays,
    primary: true,
    permission: ['calendar.manage_own', 'calendar.view_free_busy'],
    group: 'workday',
  },
  {
    path: '/time',
    labelKey: 'time',
    icon: Timer,
    primary: false,
    permission: ['time.log', 'time.view'],
    group: 'workday',
  },
  {
    path: '/projects',
    labelKey: 'projects',
    icon: Briefcase,
    primary: false,
    permission: 'project.view',
    group: 'work',
  },
  {
    path: '/tasks',
    labelKey: 'tasks',
    icon: ListChecks,
    primary: false,
    permission: 'task.view',
    group: 'work',
  },
  {
    path: '/capacity',
    labelKey: 'capacity',
    icon: Gauge,
    primary: false,
    permission: 'capacity.view',
    group: 'work',
  },
  {
    path: '/employees',
    labelKey: 'employees',
    icon: Users,
    primary: false,
    permission: 'employee.view_directory',
    group: 'people',
  },
  {
    path: '/organization',
    labelKey: 'organization',
    icon: Network,
    primary: false,
    permission: 'org.view',
    group: 'people',
  },
  {
    path: '/goals',
    labelKey: 'goals',
    icon: Target,
    primary: false,
    permission: 'goal.view',
    group: 'growth',
  },
  {
    path: '/one-on-ones',
    labelKey: 'oneOnOnes',
    icon: MessagesSquare,
    primary: false,
    permission: 'one_on_one.manage',
    group: 'growth',
  },
  {
    path: '/feedback',
    labelKey: 'feedback',
    icon: MessageSquareText,
    primary: false,
    permission: ['feedback.give', 'feedback.view_received'],
    group: 'growth',
  },
  {
    path: '/skills',
    labelKey: 'skills',
    icon: Award,
    primary: false,
    permission: 'skill.view',
    group: 'growth',
  },
  {
    path: '/reviews',
    labelKey: 'reviews',
    icon: ClipboardCheck,
    primary: false,
    permission: 'review.view',
    group: 'growth',
  },
  {
    path: '/analytics',
    labelKey: 'analytics',
    icon: ChartColumn,
    primary: false,
    permission: 'analytics.view_team',
    group: 'insights',
  },
  {
    path: '/roles',
    labelKey: 'roles',
    icon: ShieldCheck,
    primary: false,
    permission: 'admin.role.view',
    group: 'admin',
  },
  {
    path: '/retention',
    labelKey: 'retention',
    icon: Archive,
    primary: false,
    permission: 'gdpr.manage_retention',
    group: 'admin',
  },
];

/** The entries the current user may open (cosmetic filtering; routes and the API enforce it). */
export function visibleNavItems(granted: GrantedPermissions | undefined): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => !item.permission || userHasPermission(granted, item.permission),
  );
}

/** The visible entries by group, in menu order; groups without a visible entry are left out. */
export function groupNavItems(items: readonly NavItem[]): { group: NavGroup; items: NavItem[] }[] {
  return NAV_GROUPS.map((group) => ({
    group,
    items: items.filter((i) => i.group === group),
  })).filter((g) => g.items.length > 0);
}
