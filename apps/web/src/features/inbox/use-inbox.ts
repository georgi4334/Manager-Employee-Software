import {
  addDays,
  todayIn,
  type CalendarEvent,
  type FeedbackItem,
  type GrantedPermissions,
  type LeaveRequest,
  type ReviewSummary,
  type Timesheet,
} from '@intime/contracts';
import { useQuery } from '@tanstack/react-query';
import { userHasPermission } from '@/features/auth/permissions';
import { useCurrentUser } from '@/features/auth/use-auth';
import { calendarKeys, fetchEvents } from '@/features/calendar/api';
import { feedbackKeys, fetchFeedback } from '@/features/feedback/api';
import { fetchRequests, leaveKeys } from '@/features/leave/api';
import { fetchReviews, reviewKeys } from '@/features/reviews/api';
import { fetchTimesheets, timeKeys } from '@/features/time/api';

export const INBOX_KINDS = ['leave', 'timesheet', 'review', 'feedback', 'invitation'] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export type InboxItem =
  | { kind: 'leave'; key: string; request: LeaveRequest }
  | { kind: 'timesheet'; key: string; sheet: Timesheet }
  | { kind: 'review'; key: string; review: ReviewSummary; part: 'self' | 'manager'; late: boolean }
  | { kind: 'feedback'; key: string; item: FeedbackItem }
  | { kind: 'invitation'; key: string; event: CalendarEvent };

/** How far ahead invitations are looked for. */
export const INVITATION_DAYS = 60;
/** The badge is on every page; the lists behind it are fresh enough for a minute. */
const STALE_MS = 60_000;

/** The same parameters (and so the same cache) as the pages that list these items. */
export const LEAVE_PARAMS = { approvable: true, page: 1, pageSize: 100 } as const;
export const REPORTED_PARAMS = { box: 'reported', employeeId: '', page: 1 } as const;
const MINE = { box: 'mine', cycleId: '', page: 1 } as const;
const TEAM = { box: 'team', cycleId: '', page: 1 } as const;

const byText =
  <T>(get: (x: T) => string) =>
  (a: T, b: T) =>
    get(a).localeCompare(get(b));

/** Which sources the user may read at all (the API decides again). */
export function inboxSources(granted: GrantedPermissions | undefined) {
  const reviewScope = granted?.['review.view'];
  return {
    leave: userHasPermission(granted, 'leave.approve'),
    timesheet: userHasPermission(granted, 'timesheet.approve'),
    reviewMine: Boolean(reviewScope),
    reviewTeam: reviewScope === 'reports' || reviewScope === 'all',
    feedback: userHasPermission(granted, 'feedback.moderate'),
    invitation: userHasPermission(granted, 'calendar.manage_own'),
  };
}

/** Turns the raw lists into inbox items, oldest first inside each kind (pure, tested). */
export function buildInbox(lists: {
  leave?: readonly LeaveRequest[];
  sheets?: readonly Timesheet[];
  mine?: readonly ReviewSummary[];
  team?: readonly ReviewSummary[];
  reported?: readonly FeedbackItem[];
  events?: readonly CalendarEvent[];
}): InboxItem[] {
  const leave = [...(lists.leave ?? [])]
    .filter((r) => r.status === 'pending' && r.canApprove)
    .sort(byText((r) => r.createdAt))
    .map((request): InboxItem => ({ kind: 'leave', key: `leave:${request.id}`, request }));
  const sheets = [...(lists.sheets ?? [])]
    .filter((s) => s.status === 'submitted' && s.canDecide)
    .sort(byText((s) => s.submittedAt))
    .map((sheet): InboxItem => ({ kind: 'timesheet', key: `sheet:${sheet.id}`, sheet }));
  const reviews: InboxItem[] = [
    ...(lists.mine ?? [])
      .filter((r) => r.cycle.status === 'open' && !r.selfSubmitted)
      .map((review): InboxItem => ({
        kind: 'review',
        key: `review:self:${review.id}`,
        review,
        part: 'self',
        late: review.selfOverdue,
      })),
    ...(lists.team ?? [])
      .filter((r) => r.cycle.status === 'open' && r.managerSubmitted === false)
      .map((review): InboxItem => ({
        kind: 'review',
        key: `review:manager:${review.id}`,
        review,
        part: 'manager',
        late: review.managerOverdue === true,
      })),
  ].sort((a, b) => Number(b.kind === 'review' && b.late) - Number(a.kind === 'review' && a.late));
  const reported = [...(lists.reported ?? [])]
    .filter((f) => f.report === 'open')
    .sort(byText((f) => f.createdAt))
    .map((item): InboxItem => ({ kind: 'feedback', key: `feedback:${item.id}`, item }));
  // A series answers once: one row per event, at its first occurrence in the window.
  const seen = new Set<string>();
  const invitations = [...(lists.events ?? [])]
    .filter((e) => e.myResponse === 'needs_action')
    .sort(byText((e) => `${e.occurrenceDate} ${e.startTime ?? ''}`))
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .map((event): InboxItem => ({ kind: 'invitation', key: `event:${event.id}`, event }));
  return [...leave, ...sheets, ...reviews, ...reported, ...invitations];
}

/** Everything waiting for the signed-in user, from the existing scoped lists. */
export function useInbox() {
  const { data: user } = useCurrentUser();
  const granted = user?.permissions as GrantedPermissions | undefined;
  const can = inboxSources(granted);
  const today = todayIn(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const to = addDays(today, INVITATION_DAYS);
  const opts = { staleTime: STALE_MS, retry: false } as const;

  const leave = useQuery({
    queryKey: leaveKeys.requests(LEAVE_PARAMS),
    queryFn: () => fetchRequests(LEAVE_PARAMS),
    enabled: Boolean(user) && can.leave,
    ...opts,
  });
  const sheets = useQuery({
    queryKey: timeKeys.sheets('submitted'),
    queryFn: () => fetchTimesheets('submitted'),
    enabled: Boolean(user) && can.timesheet,
    ...opts,
  });
  const mine = useQuery({
    queryKey: reviewKeys.list(MINE),
    queryFn: () => fetchReviews(MINE),
    enabled: Boolean(user) && can.reviewMine,
    ...opts,
  });
  const team = useQuery({
    queryKey: reviewKeys.list(TEAM),
    queryFn: () => fetchReviews(TEAM),
    enabled: Boolean(user) && can.reviewTeam,
    ...opts,
  });
  const reported = useQuery({
    queryKey: feedbackKeys.list(REPORTED_PARAMS),
    queryFn: () => fetchFeedback(REPORTED_PARAMS),
    enabled: Boolean(user) && can.feedback,
    ...opts,
  });
  const events = useQuery({
    queryKey: calendarKeys.events(today, to),
    queryFn: () => fetchEvents(today, to),
    enabled: Boolean(user) && can.invitation,
    ...opts,
  });

  const queries = [leave, sheets, mine, team, reported, events];
  const items = buildInbox({
    leave: leave.data?.items,
    sheets: sheets.data?.items,
    mine: mine.data?.items,
    team: team.data?.items,
    reported: reported.data?.items,
    events: events.data?.items,
  });
  return {
    items,
    isPending: queries.some((q) => q.fetchStatus === 'fetching' && q.isPending),
    error: queries.find((q) => q.isError)?.error ?? null,
    refetch: () => queries.forEach((q) => q.isError && void q.refetch()),
  };
}

export const countByKind = (items: readonly InboxItem[]) =>
  Object.fromEntries(
    INBOX_KINDS.map((k) => [k, items.filter((i) => i.kind === k).length]),
  ) as Record<InboxKind, number>;
