import type { GrantedPermissions, PermissionCode, PermissionScope } from '@intime/contracts';
import { userHasPermission, type PermissionRequirement } from '@/features/auth/permissions';
import { useCurrentUser } from '@/features/auth/use-auth';

type Rule = (granted: GrantedPermissions | undefined) => boolean;

export interface PageSections {
  /** The i18n namespace whose `tabs.<name>` keys label the sections. */
  ns:
    | 'attendance'
    | 'leave'
    | 'time'
    | 'projects'
    | 'organization'
    | 'feedback'
    | 'skills'
    | 'reviews'
    | 'assistant';
  /** The query parameter that picks a section; the first visible section is the page without it. */
  param: 'tab' | 'box';
  sections: readonly { name: string; when?: Rule }[];
}

const has =
  (requirement: PermissionRequirement, atLeast?: PermissionScope): Rule =>
  (granted) =>
    userHasPermission(granted, requirement, atLeast);
const scopeOf = (granted: GrantedPermissions | undefined, code: PermissionCode) => granted?.[code];

/**
 * The sections (tabs) of each page and who sees them (docs/adr/0037-navigation-groups.md). The pages build their tab
 * lists from here and the side menu shows the same list under the open entry, so the two never drift apart. Cosmetic:
 * the routes and the API decide.
 */
export const PAGE_SECTIONS = {
  '/attendance': {
    ns: 'attendance',
    param: 'tab',
    sections: [
      { name: 'today', when: has('attendance.record') },
      {
        name: 'history',
        when: (g) => has('attendance.record')(g) && has('attendance.view')(g),
      },
      { name: 'team', when: has('attendance.view', 'reports') },
    ],
  },
  '/leave': {
    ns: 'leave',
    param: 'tab',
    sections: [
      { name: 'my', when: has('leave.request') },
      { name: 'approvals', when: has('leave.approve') },
      { name: 'team', when: has('leave.view', 'reports') },
      { name: 'settings', when: has('leave.manage_types_policies') },
    ],
  },
  '/time': {
    ns: 'time',
    param: 'tab',
    sections: [
      { name: 'week', when: has(['time.log', 'time.view']) },
      { name: 'approvals', when: has('timesheet.approve') },
      {
        name: 'reports',
        when: (g) => has('time.report_project')(g) || has('time.view', 'reports')(g),
      },
    ],
  },
  '/projects': {
    ns: 'projects',
    param: 'tab',
    sections: [{ name: 'projects' }, { name: 'clients', when: has('client.view') }],
  },
  '/organization': {
    ns: 'organization',
    param: 'tab',
    sections: [{ name: 'chart' }, { name: 'departments' }, { name: 'teams' }],
  },
  '/feedback': {
    ns: 'feedback',
    param: 'box',
    sections: [
      { name: 'received', when: has('feedback.view_received') },
      { name: 'given', when: has('feedback.give') },
      { name: 'reported', when: has('feedback.moderate') },
    ],
  },
  '/skills': {
    ns: 'skills',
    param: 'tab',
    sections: [
      { name: 'mine' },
      { name: 'people' },
      { name: 'catalog', when: has('skill.manage_catalog') },
    ],
  },
  '/reviews': {
    ns: 'reviews',
    param: 'tab',
    sections: [
      { name: 'mine' },
      {
        name: 'team',
        when: (g) => ['reports', 'all'].includes(scopeOf(g, 'review.view') ?? ''),
      },
      { name: 'all', when: (g) => scopeOf(g, 'review.view') === 'all' },
      { name: 'cycles', when: has('review.manage_cycles') },
    ],
  },
  '/assistant': {
    ns: 'assistant',
    param: 'tab',
    sections: [{ name: 'chat' }, { name: 'settings' }],
  },
} as const satisfies Record<string, PageSections>;

export type SectionPage = keyof typeof PAGE_SECTIONS;
export type SectionName<P extends SectionPage> =
  (typeof PAGE_SECTIONS)[P]['sections'][number]['name'];

/** The sections of a page the user sees, in order. */
export function visibleSections<P extends SectionPage>(
  page: P,
  granted: GrantedPermissions | undefined,
): SectionName<P>[] {
  const sections: readonly { name: string; when?: Rule }[] = PAGE_SECTIONS[page].sections;
  return sections.filter((s) => !s.when || s.when(granted)).map((s) => s.name as SectionName<P>);
}

/** The link to a section: the first one is the page itself. */
export function sectionHref(page: SectionPage, name: string, first: string): string {
  return name === first ? page : `${page}?${PAGE_SECTIONS[page].param}=${name}`;
}

/** The sections of a page the signed-in user sees. */
export function useVisibleSections<P extends SectionPage>(page: P): SectionName<P>[] {
  const { data: user } = useCurrentUser();
  return visibleSections(page, user?.permissions as GrantedPermissions | undefined);
}
