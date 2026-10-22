import {
  CalendarDays,
  CalendarOff,
  Clock,
  LayoutDashboard,
  Network,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type navMessages from '@/i18n/locales/en/nav.json';

export interface NavItem {
  path: string;
  /** Key in the `nav` translation namespace. */
  labelKey: keyof typeof navMessages;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar; the rest live under "More". */
  primary: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/', labelKey: 'dashboard', icon: LayoutDashboard, primary: true },
  { path: '/attendance', labelKey: 'attendance', icon: Clock, primary: true },
  { path: '/leave', labelKey: 'leave', icon: CalendarOff, primary: true },
  { path: '/calendar', labelKey: 'calendar', icon: CalendarDays, primary: true },
  { path: '/employees', labelKey: 'employees', icon: Users, primary: false },
  { path: '/organization', labelKey: 'organization', icon: Network, primary: false },
];
