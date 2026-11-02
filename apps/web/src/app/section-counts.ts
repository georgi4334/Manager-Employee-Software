import { useFeedback } from '@/features/feedback/hooks';
import { useLeaveRequests } from '@/features/leave/hooks';
import { useTimesheets } from '@/features/time/hooks';
import type { SectionPage } from './sections';

/** A count next to a section in the menu; `more` when the list the count comes from was cut off. */
export interface SectionCount {
  count: number;
  more: boolean;
}

/**
 * How many things wait for the user in a section of the open page (docs/adr/0037-navigation-groups.md): leave requests
 * to decide, timesheets to decide, reported feedback to moderate. Each count uses the same request (and cache) as the
 * section's own list, so opening the tab costs nothing more and a decision there updates the menu. Only the open page
 * asks, and only for sections the user sees. Informational: the API decides what is listed.
 */
export function useSectionCounts(
  page: SectionPage,
  names: readonly string[],
): Partial<Record<string, SectionCount>> {
  const leave = useLeaveRequests(
    { approvable: true, page: 1, pageSize: 100 },
    page === '/leave' && names.includes('approvals'),
  );
  const sheets = useTimesheets('submitted', page === '/time' && names.includes('approvals'));
  const reported = useFeedback(
    { box: 'reported', employeeId: '', page: 1 },
    page === '/feedback' && names.includes('reported'),
  );

  if (page === '/leave' && leave.data) {
    return { approvals: { count: leave.data.total, more: false } };
  }
  if (page === '/time' && sheets.data) {
    // The list also holds the user's own submitted week, which nobody decides themselves.
    const { items, total } = sheets.data;
    return {
      approvals: { count: items.filter((s) => s.canDecide).length, more: total > items.length },
    };
  }
  if (page === '/feedback' && reported.data) {
    return { reported: { count: reported.data.total, more: false } };
  }
  return {};
}
