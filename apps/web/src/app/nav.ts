import {
  CalendarDays,
  CalendarOff,
  Clock,
  LayoutDashboard,
  Network,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  path: string;
  /** Temporary English label; replaced by i18n keys in Phase 0 step 3. */
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar; the rest live under "More". */
  primary: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, primary: true },
  { path: '/attendance', label: 'Attendance', icon: Clock, primary: true },
  { path: '/leave', label: 'Leave', icon: CalendarOff, primary: true },
  { path: '/calendar', label: 'Calendar', icon: CalendarDays, primary: true },
  { path: '/employees', label: 'Employees', icon: Users, primary: false },
  { path: '/organization', label: 'Organization', icon: Network, primary: false },
];
