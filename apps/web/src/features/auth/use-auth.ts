import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authKeys, fetchCurrentUser, logout } from './api';
import { clearSession } from './session';

export function useCurrentUser() {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: true,
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: logout,
    // The server forgets the session when it can; locally we always sign out, even if offline.
    onSettled: () => clearSession(client),
  });
}
