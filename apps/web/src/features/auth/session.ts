import type { QueryClient } from '@tanstack/react-query';
import type { CurrentUser } from '@intime/contracts';
import { authKeys } from './api';

/**
 * Forgets who is signed in and drops every cached server response about that user, so nothing from the
 * previous user (possibly on a shared computer) can show up for the next one. Queries under the "auth"
 * key (sign-in methods, invitation checks) are not user data and stay: the login page is showing them.
 */
export function clearSession(client: QueryClient): void {
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
  client.setQueryData(authKeys.me, null);
}

export function startSession(client: QueryClient, user: CurrentUser): void {
  client.setQueryData(authKeys.me, user);
}
