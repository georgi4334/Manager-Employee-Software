import type { CurrentUser, InvitationInfo, LoginRequest } from '@intime/contracts';
import { isApiError } from '@/shared/api/api-error';
import { apiRequest } from '@/shared/api/client';

export const authKeys = {
  me: ['auth', 'me'] as const,
  providers: ['auth', 'providers'] as const,
  invitation: (token: string) => ['auth', 'invitation', token] as const,
};

/** The signed-in user, or null when nobody is signed in. Other failures (network, 5xx) are thrown. */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await apiRequest<CurrentUser>('/auth/me');
  } catch (error) {
    if (isApiError(error, 'UNAUTHENTICATED')) return null;
    throw error;
  }
}

export const fetchProviders = () => apiRequest<{ google: boolean }>('/auth/providers');

export const login = (body: LoginRequest) =>
  apiRequest<CurrentUser>('/auth/login', { method: 'POST', body, skipRefresh: true });

export const logout = () => apiRequest('/auth/logout', { method: 'POST', skipRefresh: true });

export const inspectInvitation = (token: string) =>
  apiRequest<InvitationInfo>('/auth/invitations/inspect', {
    method: 'POST',
    body: { token },
    skipRefresh: true,
  });

export const acceptInvitation = (body: { token: string; password: string }) =>
  apiRequest<CurrentUser>('/auth/invitations/accept', { method: 'POST', body, skipRefresh: true });

export const forgotPassword = (body: { email: string }) =>
  apiRequest('/auth/password/forgot', { method: 'POST', body, skipRefresh: true });

export const resetPassword = (body: { token: string; password: string }) =>
  apiRequest('/auth/password/reset', { method: 'POST', body, skipRefresh: true });
