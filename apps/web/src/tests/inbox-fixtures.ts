import type {
  CalendarEvent,
  FeedbackItem,
  LeaveRequest,
  ReviewSummary,
  Timesheet,
} from '@intime/contracts';

/** Items for the "Waiting for me" tests (docs/adr/0038-waiting-for-me.md). */
export const uuid = (n: number) => `0192f5a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
export const DAN = { id: uuid(70), firstName: 'Dan', lastName: 'Dev' };

export const leave = (n: number, o: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: uuid(100 + n),
  employee: DAN,
  leaveType: { id: uuid(1), key: 'annual', name: null, color: 'success', isSick: false },
  masked: false,
  startDate: '2026-11-09',
  endDate: '2026-11-10',
  halfDayStart: false,
  halfDayEnd: false,
  days: 2,
  status: 'pending',
  reason: null,
  decisionComment: null,
  decidedAt: null,
  createdAt: '2026-10-30T08:00:00.000Z',
  canApprove: true,
  canCancel: false,
  ...o,
});

export const sheet = (n: number, o: Partial<Timesheet> = {}): Timesheet => ({
  id: uuid(200 + n),
  employee: DAN,
  weekStart: '2026-10-26',
  status: 'submitted',
  totalMinutes: 2400,
  submittedAt: '2026-10-31T09:00:00Z',
  decidedAt: null,
  canDecide: true,
  canReopen: false,
  ...o,
});

export const review = (n: number, o: Partial<ReviewSummary> = {}): ReviewSummary => ({
  id: uuid(300 + n),
  cycle: { id: uuid(2), name: 'H2 2026', status: 'open' },
  employee: DAN,
  selfSubmitted: false,
  managerSubmitted: null,
  released: false,
  finalRating: null,
  selfOverdue: false,
  managerOverdue: null,
  ...o,
});

export const reported = (n: number, o: Partial<FeedbackItem> = {}): FeedbackItem => ({
  id: uuid(400 + n),
  from: DAN,
  to: { id: uuid(71), firstName: 'Eva', lastName: 'Martin' },
  kind: 'constructive',
  visibility: 'recipient',
  body: 'text',
  createdAt: '2026-10-29T10:00:00Z',
  report: 'open',
  canReport: false,
  canRemove: true,
  canKeep: true,
  ...o,
});

export const event = (n: number, o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: uuid(500 + n),
  scope: 'personal',
  team: null,
  owner: DAN,
  title: `Planning ${n}`,
  description: null,
  location: null,
  allDay: false,
  startDate: '2026-11-05',
  endDate: '2026-11-05',
  startTime: '10:00',
  endTime: '11:00',
  canEdit: false,
  recurrence: null,
  occurrenceDate: '2026-11-05',
  isOrganizer: false,
  attendees: [],
  myResponse: 'needs_action',
  reminderMinutes: null,
  ...o,
});
