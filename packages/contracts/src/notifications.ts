import { z } from 'zod';

/**
 * The notification catalog (docs/adr/0004-notifications.md). A feature can only notify with a type listed
 * here; parameters are validated when published, and the web app translates `type` + `params`
 * (display text is never stored).
 */

export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export interface NotificationTypeDef {
  /** Parameters of the notification: ids and short non-sensitive labels only, never free text from people. */
  readonly params: z.ZodType<Record<string, unknown>>;
  /** Used until the person chooses otherwise. */
  readonly defaults: Readonly<Record<NotificationChannel, boolean>>;
  /** Channels the person cannot switch off (e.g. security-relevant notices). */
  readonly locked: Readonly<Partial<Record<NotificationChannel, true>>>;
  /** Where the notification leads, as a path in the web app. */
  readonly link: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const typeDef = <const T extends NotificationTypeDef>(definition: T): T => definition;

export const NOTIFICATION_TYPES = {
  'account.roles_changed': typeDef({
    params: z.object({ roleNames: z.array(z.string().trim().min(1).max(100)).min(1).max(10) }),
    defaults: { in_app: true, email: true },
    locked: { email: true },
    link: '/notifications',
  }),
  // Attendance (docs/adr/0009-attendance.md): somebody else changed your record. Date and kind only.
  'attendance.corrected': typeDef({
    params: z.object({
      date: z.string().regex(DATE),
      action: z.enum(['created', 'updated', 'deleted']),
    }),
    defaults: { in_app: true, email: true },
    locked: {},
    link: '/attendance',
  }),
  // 1:1 meetings (docs/adr/0020-one-on-ones.md): the other person scheduled, moved or cancelled one. Date only.
  'one_on_one.changed': typeDef({
    params: z.object({
      meetingId: z.uuid(),
      date: z.string().regex(DATE),
      action: z.enum(['scheduled', 'rescheduled', 'cancelled']),
    }),
    defaults: { in_app: true, email: true },
    locked: {},
    link: '/one-on-ones',
  }),
  // Feedback (docs/adr/0021-feedback.md): somebody gave you feedback. The id only: not who, not what, not which kind.
  'feedback.received': typeDef({
    params: z.object({ feedbackId: z.uuid() }),
    defaults: { in_app: true, email: true },
    locked: {},
    link: '/feedback',
  }),
  // Performance reviews (docs/adr/0023-performance-reviews.md): a cycle opened for you, and your result was released.
  'review.cycle_opened': typeDef({
    params: z.object({ cycleId: z.uuid() }),
    defaults: { in_app: true, email: true },
    locked: {},
    link: '/reviews',
  }),
  'review.released': typeDef({
    params: z.object({ reviewId: z.uuid() }),
    defaults: { in_app: true, email: true },
    locked: {},
    link: '/reviews',
  }),
  // Projects (docs/adr/0013-clients-and-projects.md): you were put on a project. Ids and the project name only.
  'project.assigned': typeDef({
    params: z.object({ projectId: z.uuid(), projectName: z.string().trim().min(1).max(120) }),
    defaults: { in_app: true, email: true },
    locked: {},
    link: '/projects',
  }),
  // Tasks (docs/adr/0014-tasks.md): a task was given to you. The reference (WEB-12) only, never the title.
  'task.assigned': typeDef({
    params: z.object({ projectId: z.uuid(), taskKey: z.string().trim().min(1).max(30) }),
    defaults: { in_app: true, email: true },
    locked: {},
    link: '/tasks',
  }),
  // Time (docs/adr/0015-time-tracker.md): your week was approved or sent back. The week and the decision only.
  'timesheet.decided': typeDef({
    params: z.object({
      weekStart: z.string().regex(DATE),
      decision: z.enum(['approved', 'rejected']),
    }),
    defaults: { in_app: true, email: true },
    locked: {},
    link: '/time',
  }),
  // Goals (docs/adr/0019-goals.md): somebody set a personal goal for you. The goal id only, never the title.
  'goal.assigned': typeDef({
    params: z.object({ goalId: z.uuid() }),
    defaults: { in_app: true, email: true },
    locked: {},
    link: '/goals',
  }),
  // Reminders (docs/adr/0017-integrations.md): something started and was never finished. The day only.
  'attendance.reminder': typeDef({
    params: z.object({ date: z.string().regex(DATE) }),
    defaults: { in_app: true, email: true },
    locked: {},
    link: '/attendance',
  }),
  'time.timer_reminder': typeDef({
    params: z.object({ date: z.string().regex(DATE) }),
    defaults: { in_app: true, email: true },
    locked: {},
    link: '/time',
  }),
  // Leave (docs/adr/0008-leave.md). Names and dates only: never the type of a sick request, never reasons.
  'leave.requested': typeDef({
    params: z.object({
      requestId: z.uuid(),
      employeeName: z.string().trim().min(1).max(200),
      startDate: z.string().regex(DATE),
      endDate: z.string().regex(DATE),
      days: z.number().positive().max(366),
      /** Types without approval (sick leave): the manager is only informed. */
      autoApproved: z.boolean(),
    }),
    defaults: { in_app: true, email: true },
    locked: {},
    link: '/leave?tab=approvals',
  }),
  'leave.decided': typeDef({
    params: z.object({
      requestId: z.uuid(),
      status: z.enum(['approved', 'rejected']),
      startDate: z.string().regex(DATE),
      endDate: z.string().regex(DATE),
    }),
    defaults: { in_app: true, email: true },
    locked: {},
    link: '/leave',
  }),
  'leave.cancelled': typeDef({
    params: z.object({
      requestId: z.uuid(),
      employeeName: z.string().trim().min(1).max(200),
      startDate: z.string().regex(DATE),
      endDate: z.string().regex(DATE),
      by: z.enum(['employee', 'approver']),
    }),
    defaults: { in_app: true, email: true },
    locked: {},
    link: '/leave',
  }),
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export type NotificationParams<T extends NotificationType> = z.infer<
  (typeof NOTIFICATION_TYPES)[T]['params']
>;

export const NOTIFICATION_TYPE_KEYS = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && Object.hasOwn(NOTIFICATION_TYPES, value);
}

export function isNotificationChannel(value: unknown): value is NotificationChannel {
  return typeof value === 'string' && (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}

export interface ChannelState {
  enabled: boolean;
  /** True when the person may not change it. */
  locked: boolean;
}

/**
 * What actually happens for a type: the stored preference, else the default; locked channels are always on.
 * Unknown types get nothing (fail closed).
 */
export function resolveChannels(
  type: string,
  stored: Partial<Record<NotificationChannel, boolean>> = {},
): Record<NotificationChannel, ChannelState> {
  const off: Record<NotificationChannel, ChannelState> = {
    in_app: { enabled: false, locked: false },
    email: { enabled: false, locked: false },
  };
  if (!isNotificationType(type)) return off;
  const definition: NotificationTypeDef = NOTIFICATION_TYPES[type];
  const state = (channel: NotificationChannel): ChannelState => {
    const locked = definition.locked[channel] === true;
    return { locked, enabled: locked ? true : (stored[channel] ?? definition.defaults[channel]) };
  };
  return { in_app: state('in_app'), email: state('email') };
}

/** Validates parameters for a type; throws a ZodError for anything that does not match the catalog. */
export function parseNotificationParams(
  type: NotificationType,
  params: unknown,
): Record<string, unknown> {
  return NOTIFICATION_TYPES[type].params.parse(params);
}

// ----- API ---------------------------------------------------------------------------------------

export const notificationItemSchema = z.object({
  id: z.uuid(),
  /** Usually a catalog type; kept as text so a newer server cannot break an older client. */
  type: z.string(),
  params: z.record(z.string(), z.unknown()),
  link: z.string(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

export const notificationListSchema = z.object({
  items: z.array(notificationItemSchema),
  unreadCount: z.number().int().min(0),
  /** Pass as `before` to get the next (older) page; null when there is none. */
  nextCursor: z.uuid().nullable(),
});
export type NotificationList = z.infer<typeof notificationListSchema>;

export const MAX_NOTIFICATION_PAGE = 50;

export const notificationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_NOTIFICATION_PAGE).default(20),
  before: z.uuid().optional(),
  unreadOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
export type NotificationQuery = z.output<typeof notificationQuerySchema>;

export const channelStateSchema = z.object({ enabled: z.boolean(), locked: z.boolean() });

export const notificationPreferenceSchema = z.object({
  type: z.string(),
  channels: z.object({ in_app: channelStateSchema, email: channelStateSchema }),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const updateNotificationPreferenceSchema = z.object({
  type: z.string().refine(isNotificationType, { message: 'unknown_type' }),
  channel: z.enum(NOTIFICATION_CHANNELS),
  enabled: z.boolean(),
});
export type UpdateNotificationPreference = z.infer<typeof updateNotificationPreferenceSchema>;
