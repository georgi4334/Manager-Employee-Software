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
} as const;

export type EventType = keyof typeof EVENT_DEFINITIONS;
export type EventParams<T extends EventType> = z.input<(typeof EVENT_DEFINITIONS)[T]['params']>;

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && Object.hasOwn(EVENT_DEFINITIONS, value);
}
