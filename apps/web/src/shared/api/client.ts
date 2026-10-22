import { ApiError, parseErrorResponse } from './api-error';
import { useApiStatusStore } from './api-status.store';

export const API_PREFIX = '/api/v1';

/** Absolute URL for full-page navigations to the API (Google sign-in). */
export function apiUrl(path: string): string {
  return `${baseUrl()}${API_PREFIX}${path}`;
}
/** After this long without an answer the UI says the server is waking up. */
export const SLOW_REQUEST_MS = 4_000;
/** A sleeping free-tier server can need about a minute; beyond that we give up. */
export const REQUEST_TIMEOUT_MS = 65_000;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Do not try a token refresh on 401 (sign-in and refresh calls themselves). */
  skipRefresh?: boolean;
}

function baseUrl(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined) || window.location.origin;
}

let onSessionExpired: (() => void) | undefined;
let refreshing: Promise<boolean> | undefined;

/** Called when a refresh fails: the app clears its session state and shows the login page. */
export function setSessionExpiredHandler(handler: (() => void) | undefined): void {
  onSessionExpired = handler;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  let slow = false;

  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const slowTimer = setTimeout(() => {
    slow = true;
    useApiStatusStore.getState().slowStarted();
  }, SLOW_REQUEST_MS);
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller);

  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  try {
    return await fetch(apiUrl(path), {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(timedOut ? 'TIMEOUT' : 'NETWORK', 0);
  } finally {
    clearTimeout(timeoutTimer);
    clearTimeout(slowTimer);
    options.signal?.removeEventListener('abort', abortFromCaller);
    if (slow) useApiStatusStore.getState().slowEnded();
  }
}

/** One refresh at a time: parallel 401s wait for the same attempt (refresh tokens rotate, so racing would log users out). */
function refreshSession(): Promise<boolean> {
  refreshing ??= send('/auth/refresh', { method: 'POST' })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}

export async function apiRequest<T = void>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options);

  if (response.status === 401 && !options.skipRefresh) {
    const code = (await parseErrorResponse(response.clone())).code;
    if (code === 'UNAUTHENTICATED') {
      if (await refreshSession()) {
        response = await send(path, options);
      } else {
        onSessionExpired?.();
      }
    }
  }

  if (!response.ok) throw await parseErrorResponse(response);

  // Some successes have no body (204, or 202 for "accepted"); only parse when there is something.
  const text = await response.text();
  if (text === '') return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('UNKNOWN', response.status);
  }
}
