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
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/', labelKey: 'dashboard', icon: LayoutDashboard, primary: true },
  {
    path: '/attendance',
    labelKey: 'attendance',
    icon: Clock,
    primary: true,
    permission: ['attendance.record', 'attendance.view'],
  },
  {
    path: '/leave',
    labelKey: 'leave',
    icon: CalendarOff,
    primary: true,
    permission: ['leave.request', 'leave.view'],
  },
  {
    path: '/calendar',
    labelKey: 'calendar',
    icon: CalendarDays,
    primary: true,
    permission: ['calendar.manage_own', 'calendar.view_free_busy'],
  },
  {
    path: '/projects',
    labelKey: 'projects',
    icon: Briefcase,
    primary: false,
    permission: 'project.view',
  },
  {
    path: '/tasks',
    labelKey: 'tasks',
    icon: ListChecks,
    primary: false,
    permission: 'task.view',
  },
  {
    path: '/time',
    labelKey: 'time',
    icon: Timer,
    primary: false,
    permission: ['time.log', 'time.view'],
  },
  {
    path: '/capacity',
    labelKey: 'capacity',
    icon: Gauge,
    primary: false,
    permission: 'capacity.view',
  },
  {
    path: '/goals',
    labelKey: 'goals',
    icon: Target,
    primary: false,
    permission: 'goal.view',
  },
  {
    path: '/one-on-ones',
    labelKey: 'oneOnOnes',
    icon: MessagesSquare,
    primary: false,
    permission: 'one_on_one.manage',
  },
  {
    path: '/feedback',
    labelKey: 'feedback',
    icon: MessageSquareText,
    primary: false,
    permission: ['feedback.give', 'feedback.view_received'],
  },
  {
    path: '/skills',
    labelKey: 'skills',
    icon: Award,
    primary: false,
    permission: 'skill.view',
  },
  {
    path: '/reviews',
    labelKey: 'reviews',
    icon: ClipboardCheck,
    primary: false,
    permission: 'review.view',
  },
  {
    path: '/analytics',
    labelKey: 'analytics',
    icon: ChartColumn,
    primary: false,
    permission: 'analytics.view_team',
  },
  {
    path: '/assistant',
    labelKey: 'assistant',
    icon: Sparkles,
    primary: false,
    permission: 'ai.use',
  },
  {
    path: '/retention',
    labelKey: 'retention',
    icon: Archive,
    primary: false,
    permission: 'gdpr.manage_retention',
  },
  {
    path: '/roles',
    labelKey: 'roles',
    icon: ShieldCheck,
    primary: false,
    permission: 'admin.role.view',
  },
  {
    path: '/employees',
    labelKey: 'employees',
    icon: Users,
    primary: false,
    permission: 'employee.view_directory',
  },
  {
    path: '/organization',
    labelKey: 'organization',
    icon: Network,
    primary: false,
    permission: 'org.view',
  },
];

/** The entries the current user may open (cosmetic filtering; routes and the API enforce it). */
export function visibleNavItems(granted: GrantedPermissions | undefined): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => !item.permission || userHasPermission(granted, item.permission),
  );
}
