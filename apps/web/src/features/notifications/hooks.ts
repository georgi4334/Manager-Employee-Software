import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchNotifications,
  fetchPreferences,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  notificationKeys,
  updatePreference,
} from './api';

/** The bell checks once a minute, only while the tab is visible, and again when the user returns to it. */
export const UNREAD_POLL_MS = 60_000;

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: fetchUnreadCount,
    refetchInterval: UNREAD_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    // The badge is a convenience: a failing request must not spam retries or show errors.
    retry: false,
  });
}

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: notificationKeys.list,
    queryFn: ({ pageParam }) => fetchNotifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
}

function useRefreshNotifications() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: notificationKeys.all });
}

export function useMarkRead() {
  const refresh = useRefreshNotifications();
  return useMutation({ mutationFn: markNotificationRead, onSuccess: refresh });
}

export function useMarkAllRead() {
  const refresh = useRefreshNotifications();
  return useMutation({ mutationFn: markAllNotificationsRead, onSuccess: refresh });
}

export function usePreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences,
    queryFn: fetchPreferences,
    retry: false,
  });
}

export function useUpdatePreference() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updatePreference,
    onSuccess: () => client.invalidateQueries({ queryKey: notificationKeys.preferences }),
  });
}
