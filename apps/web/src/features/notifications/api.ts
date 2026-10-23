import type {
  NotificationList,
  NotificationPreference,
  UpdateNotificationPreference,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "notifications" is user data: signing out removes it (see clearSession). */
export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
  preferences: ['notifications', 'preferences'] as const,
};

export const PAGE_SIZE = 20;

export const fetchNotifications = (before?: string) =>
  apiRequest<NotificationList>(
    `/notifications?limit=${PAGE_SIZE}${before ? `&before=${before}` : ''}`,
  );

export const fetchUnreadCount = async () =>
  (await apiRequest<{ unreadCount: number }>('/notifications/unread-count')).unreadCount;

export const markNotificationRead = (id: string) =>
  apiRequest(`/notifications/${id}/read`, { method: 'POST' });

export const markAllNotificationsRead = () =>
  apiRequest<{ updated: number }>('/notifications/read-all', { method: 'POST' });

export const fetchPreferences = () =>
  apiRequest<NotificationPreference[]>('/notifications/preferences');

export const updatePreference = (body: UpdateNotificationPreference) =>
  apiRequest<NotificationPreference>('/notifications/preferences', { method: 'PUT', body });
