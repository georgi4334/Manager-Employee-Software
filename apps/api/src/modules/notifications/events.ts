import { z } from 'zod';
import type { NotificationType } from '@intime/contracts';

/** Somebody to tell, and what about (a type from the notification catalog in @intime/contracts). */
export interface NotificationIntent {
  recipientUserId: string;
  type: NotificationType;
  params: Record<string, unknown>;
}

const eventDef = <T extends z.ZodType>(definition: {
  params: T;
  /** Who should be notified about this event. */
  notify: (params: z.output<T>) => NotificationIntent[];
}) => definition;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const name = z.string().trim().min(1).max(200);

export const ATTENDANCE_EVENTS = {
  /** Somebody else created, changed or deleted a person's attendance record: they are told (date and kind only). */
  'attendance.corrected': eventDef({
    params: z.object({
      recipientUserId: z.uuid(),
      date: z.string().regex(DATE),
      action: z.enum(['created', 'updated', 'deleted']),
    }),
    notify: ({ recipientUserId, ...params }) => [
      { recipientUserId, type: 'attendance.corrected' as const, params },
    ],
  }),
} as const;

export const PROJECT_EVENTS = {
  /** Somebody was put on a project: they are told (project id and name only). */
  'project.assigned': eventDef({
    params: z.object({
      recipientUserId: z.uuid(),
      projectId: z.uuid(),
      projectName: z.string().trim().min(1).max(120),
    }),
    notify: ({ recipientUserId, ...params }) => [
      { recipientUserId, type: 'project.assigned' as const, params },
    ],
  }),
} as const;

export const TASK_EVENTS = {
  /** A task was given to somebody: the project and the reference (WEB-12) only, never the title. */
  'task.assigned': eventDef({
    params: z.object({
      recipientUserId: z.uuid(),
      projectId: z.uuid(),
      taskKey: z.string().trim().min(1).max(30),
    }),
    notify: ({ recipientUserId, ...params }) => [
      { recipientUserId, type: 'task.assigned' as const, params },
    ],
  }),
} as const;

export const TIME_EVENTS = {
  /** A week of time was approved or sent back: the week and the decision only. */
  'timesheet.decided': eventDef({
    params: z.object({
      recipientUserId: z.uuid(),
      weekStart: z.string().regex(DATE),
      decision: z.enum(['approved', 'rejected']),
    }),
    notify: ({ recipientUserId, ...params }) => [
      { recipientUserId, type: 'timesheet.decided' as const, params },
    ],
  }),
} as const;

export const GOAL_EVENTS = {
  /** Somebody set a personal goal for you: the goal id only. */
  'goal.assigned': eventDef({
    params: z.object({ recipientUserId: z.uuid(), goalId: z.uuid() }),
    notify: ({ recipientUserId, ...params }) => [
      { recipientUserId, type: 'goal.assigned' as const, params },
    ],
  }),
} as const;

export const CALENDAR_EVENTS = {
  /** You were invited to an event: the event id and the date only (never the title). */
  'calendar.invited': eventDef({
    params: z.object({
      recipientUserId: z.uuid(),
      eventId: z.uuid(),
      date: z.string().regex(DATE),
    }),
    notify: ({ recipientUserId, ...params }) => [
      { recipientUserId, type: 'calendar.invited' as const, params },
    ],
  }),
  /** A guest answered: the event, the date and the answer, not who. */
  'calendar.response': eventDef({
    params: z.object({
      recipientUserId: z.uuid(),
      eventId: z.uuid(),
      date: z.string().regex(DATE),
      response: z.enum(['accepted', 'declined', 'tentative']),
    }),
    notify: ({ recipientUserId, ...params }) => [
      { recipientUserId, type: 'calendar.response' as const, params },
    ],
  }),
  /** The organizer moved or cancelled an event you were invited to. */
  'calendar.changed': eventDef({
    params: z.object({
      recipientUserId: z.uuid(),
      eventId: z.uuid(),
      date: z.string().regex(DATE),
      action: z.enum(['updated', 'cancelled']),
    }),
    notify: ({ recipientUserId, ...params }) => [
      { recipientUserId, type: 'calendar.changed' as const, params },
    ],
  }),
} as const;

export const ONE_ON_ONE_EVENTS = {
  /** The other person scheduled, moved or cancelled a 1:1: the meeting id, the date and the kind only. */
  'one_on_one.changed': eventDef({
    params: z.object({
      recipientUserId: z.uuid(),
      meetingId: z.uuid(),
      date: z.string().regex(DATE),
      action: z.enum(['scheduled', 'rescheduled', 'cancelled']),
    }),
    notify: ({ recipientUserId, ...params }) => [
      { recipientUserId, type: 'one_on_one.changed' as const, params },
    ],
  }),
} as const;

export const FEEDBACK_EVENTS = {
  /** Somebody gave you feedback: the feedback id only (not who, not what, not which kind). */
  'feedback.received': eventDef({
    params: z.object({ recipientUserId: z.uuid(), feedbackId: z.uuid() }),
    notify: ({ recipientUserId, ...params }) => [
      { recipientUserId, type: 'feedback.received' as const, params },
    ],
  }),
} as const;

export const REVIEW_EVENTS = {
  /** A review cycle opened and there is a review for you: the cycle id only. */
  'review.cycle_opened': eventDef({
    params: z.object({ recipientUserId: z.uuid(), cycleId: z.uuid() }),
    notify: ({ recipientUserId, ...params }) => [
      { recipientUserId, type: 'review.cycle_opened' as const, params },
    ],
  }),
  /** Your review result was released: the review id only. */
  'review.released': eventDef({
    params: z.object({ recipientUserId: z.uuid(), reviewId: z.uuid() }),
    notify: ({ recipientUserId, ...params }) => [
      { recipientUserId, type: 'review.released' as const, params },
    ],
  }),
} as const;

export const REMINDER_EVENTS = {
  /** Something started and was never finished: the day only. */
  'attendance.reminder': eventDef({
    params: z.object({ recipientUserId: z.uuid(), date: z.string().regex(DATE) }),
    notify: ({ recipientUserId, ...params }) => [
      { recipientUserId, type: 'attendance.reminder' as const, params },
    ],
  }),
  'time.timer_reminder': eventDef({
    params: z.object({ recipientUserId: z.uuid(), date: z.string().regex(DATE) }),
    notify: ({ recipientUserId, ...params }) => [
      { recipientUserId, type: 'time.timer_reminder' as const, params },
    ],
  }),
} as const;

export const LEAVE_EVENTS = {
  'leave.requested': eventDef({
    params: z.object({
      recipientUserIds: z.array(z.uuid()).min(1).max(100),
      requestId: z.uuid(),
      employeeName: name,
      startDate: z.string().regex(DATE),
      endDate: z.string().regex(DATE),
      days: z.number().positive().max(366),
      autoApproved: z.boolean(),
    }),
    notify: ({ recipientUserIds, ...params }) =>
      recipientUserIds.map((recipientUserId) => ({
        recipientUserId,
        type: 'leave.requested' as const,
        params,
      })),
  }),
  'leave.decided': eventDef({
    params: z.object({
      recipientUserId: z.uuid(),
      requestId: z.uuid(),
      status: z.enum(['approved', 'rejected']),
      startDate: z.string().regex(DATE),
      endDate: z.string().regex(DATE),
    }),
    notify: ({ recipientUserId, ...params }) => [
      { recipientUserId, type: 'leave.decided' as const, params },
    ],
  }),
  'leave.cancelled': eventDef({
    params: z.object({
      recipientUserIds: z.array(z.uuid()).min(1).max(100),
      requestId: z.uuid(),
      employeeName: name,
      startDate: z.string().regex(DATE),
      endDate: z.string().regex(DATE),
      by: z.enum(['employee', 'approver']),
    }),
    notify: ({ recipientUserIds, ...params }) =>
      recipientUserIds.map((recipientUserId) => ({
        recipientUserId,
        type: 'leave.cancelled' as const,
        params,
      })),
  }),
} as const;

/**
 * Domain events that can be published to the outbox. A feature publishes a fact ("roles changed"); what
 * that means for whom is decided here, in one place.
 */
export const EVENT_DEFINITIONS = {
  'user.roles_changed': eventDef({
    params: z.object({
      userId: z.uuid(),
      roleNames: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
    }),
    notify: ({ userId, roleNames }) => [
      { recipientUserId: userId, type: 'account.roles_changed', params: { roleNames } },
    ],
  }),
  ...LEAVE_EVENTS,
  ...ATTENDANCE_EVENTS,
  ...PROJECT_EVENTS,
  ...TASK_EVENTS,
  ...TIME_EVENTS,
  ...REMINDER_EVENTS,
  ...GOAL_EVENTS,
  ...CALENDAR_EVENTS,
  ...ONE_ON_ONE_EVENTS,
  ...FEEDBACK_EVENTS,
  ...REVIEW_EVENTS,
} as const;

export type EventType = keyof typeof EVENT_DEFINITIONS;
export type EventParams<T extends EventType> = z.input<(typeof EVENT_DEFINITIONS)[T]['params']>;

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && Object.hasOwn(EVENT_DEFINITIONS, value);
}
