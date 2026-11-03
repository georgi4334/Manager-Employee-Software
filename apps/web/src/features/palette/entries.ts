import type { GrantedPermissions } from '@intime/contracts';
import {
  Bell,
  CalendarPlus,
  CalendarOff,
  Clock,
  MessageSquarePlus,
  ShieldPlus,
  Timer,
  UserPlus,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { userHasPermission, type PermissionRequirement } from '@/features/auth/permissions';
import { useCurrentUser } from '@/features/auth/use-auth';
import { visibleNavItems } from '@/app/nav';
import { PAGE_SECTIONS, sectionHref, visibleSections, type SectionPage } from '@/app/sections';

/** Actions start where the work happens: they only navigate (docs/adr/0039-command-palette.md). */
export const PALETTE_ACTIONS = [
  { id: 'requestLeave', to: '/leave', icon: CalendarOff, permission: 'leave.request' },
  { id: 'logTime', to: '/time', icon: Timer, permission: 'time.log' },
  { id: 'checkIn', to: '/attendance', icon: Clock, permission: 'attendance.record' },
  { id: 'newEvent', to: '/calendar', icon: CalendarPlus, permission: 'calendar.manage_own' },
  { id: 'giveFeedback', to: '/feedback', icon: MessageSquarePlus, permission: 'feedback.give' },
  { id: 'addEmployee', to: '/employees/new', icon: UserPlus, permission: 'employee.create' },
  { id: 'newRole', to: '/roles/new', icon: ShieldPlus, permission: 'admin.role.manage' },
  { id: 'myProfile', to: '/profile', icon: UserRound },
  { id: 'notificationSettings', to: '/notifications/settings', icon: Bell },
] as const satisfies readonly {
  id: string;
  to: string;
  icon: LucideIcon;
  permission?: PermissionRequirement;
}[];
export type PaletteActionId = (typeof PALETTE_ACTIONS)[number]['id'];

export type PaletteTarget =
  | { kind: 'page'; id: string; to: string; icon: LucideIcon; labelKey: string }
  | {
      kind: 'section';
      id: string;
      to: string;
      icon: LucideIcon;
      labelKey: string;
      /** `<ns>:tabs.<name>` */
      sectionKey: string;
    }
  | { kind: 'action'; id: PaletteActionId; to: string; icon: LucideIcon };

/** Pages, their sections and the actions the user may use, in menu order (pure, tested). */
export function paletteTargets(granted: GrantedPermissions | undefined): PaletteTarget[] {
  const targets: PaletteTarget[] = [];
  for (const item of visibleNavItems(granted)) {
    targets.push({
      kind: 'page',
      id: item.path,
      to: item.path,
      icon: item.icon,
      labelKey: item.labelKey,
    });
    if (!(item.path in PAGE_SECTIONS)) continue;
    const page = item.path as SectionPage;
    const sections = visibleSections(page, granted) as string[];
    if (sections.length < 2) continue;
    for (const name of sections)
      targets.push({
        kind: 'section',
        id: `${page}#${name}`,
        to: sectionHref(page, name, sections[0]!),
        icon: item.icon,
        labelKey: item.labelKey,
        sectionKey: `${PAGE_SECTIONS[page].ns}:tabs.${name}`,
      });
  }
  for (const action of PALETTE_ACTIONS) {
    if ('permission' in action && !userHasPermission(granted, action.permission)) continue;
    targets.push({ kind: 'action', id: action.id, to: action.to, icon: action.icon });
  }
  return targets;
}

export interface PaletteEntry {
  kind: 'page' | 'section' | 'action';
  id: string;
  to: string;
  icon: LucideIcon;
  label: string;
}

/** The targets with their translated labels. */
export function useStaticEntries(): PaletteEntry[] {
  const { data: user } = useCurrentUser();
  const { t } = useTranslation(['palette', 'nav']);
  const permissions = user?.permissions as GrantedPermissions | undefined;
  // Built once per user and language, not on every keystroke of the palette.
  return useMemo(() => {
    const text = t as unknown as (key: string) => string;
    const entries = paletteTargets(permissions).map((target) => {
      switch (target.kind) {
        case 'page':
          return { ...target, label: text(`nav:${target.labelKey}`) };
        case 'section':
          return {
            ...target,
            label: t('palette:section', {
              page: text(`nav:${target.labelKey}`),
              section: text(target.sectionKey),
            }),
          };
        case 'action':
          return { ...target, label: t(`palette:actions.${target.id}`) };
      }
    });
    // A section named like its page ("Projects › Projects") only repeats the page entry.
    return entries.filter(
      (entry) =>
        entry.kind !== 'section' ||
        !('sectionKey' in entry) ||
        text(entry.sectionKey) !== text(`nav:${entry.labelKey}`),
    );
  }, [permissions, t]);
}
