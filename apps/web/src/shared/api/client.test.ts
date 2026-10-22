import { http, HttpResponse, delay } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, isApiError } from './api-error';
import { useApiStatusStore } from './api-status.store';
import { server } from '@/tests/server';
import { SLOW_REQUEST_MS, apiRequest, setSessionExpiredHandler } from './client';

const url = (path: string) => `http://localhost:3000/api/v1${path}`;
const errorBody = (code: string, status: number, extra: object = {}) => ({
  error: { code, message: 'x', status, requestId: 'req-1', ...extra },
});

afterEach(() => setSessionExpiredHandler(undefined));

describe('apiRequest', () => {
  it('returns parsed JSON and sends credentials and JSON bodies', async () => {
    let received: unknown;
    let contentType: string | null = null;
    server.use(
      http.post(url('/echo'), async ({ request }) => {
        received = await request.json();
        contentType = request.headers.get('content-type');
        return HttpResponse.json({ ok: true });
      }),
    );
    expect(await apiRequest('/echo', { method: 'POST', body: { a: 1 } })).toEqual({ ok: true });
    expect(received).toEqual({ a: 1 });
    expect(contentType).toBe('application/json');
  });

  it('resolves 204 responses to undefined', async () => {
    server.use(http.post(url('/auth/logout'), () => new HttpResponse(null, { status: 204 })));
    expect(await apiRequest('/auth/logout', { method: 'POST' })).toBeUndefined();
  });

  it.each([202, 204, 200])('resolves an empty %i response to undefined', async (status) => {
    server.use(http.post(url('/empty'), () => new HttpResponse(null, { status })));
    expect(await apiRequest('/empty', { method: 'POST' })).toBeUndefined();
  });

  it('fails clearly when a success response is not valid JSON (e.g. a proxy page)', async () => {
    server.use(http.get(url('/html'), () => new HttpResponse('<html>hi</html>', { status: 200 })));
    await expect(apiRequest('/html')).rejects.toMatchObject({ code: 'UNKNOWN', status: 200 });
  });

  it('turns the standard error body into an ApiError with code, params and request id', async () => {
    server.use(
      http.post(url('/auth/login'), () =>
        HttpResponse.json(
          errorBody('TENANT_SELECTION_REQUIRED', 409, {
            params: { workspaces: [{ slug: 'acme', name: 'Acme' }, { nope: 1 }] },
          }),
          { status: 409 },
        ),
      ),
    );
    const error = await apiRequest('/auth/login', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );
    expect(isApiError(error, 'TENANT_SELECTION_REQUIRED')).toBe(true);
    const apiError = error as ApiError;
    expect(apiError).toMatchObject({ status: 409, requestId: 'req-1' });
    expect(apiError.workspaces).toEqual([{ slug: 'acme', name: 'Acme' }]);
  });

  it.each([
    ['an HTML error page', () => new HttpResponse('<html>Bad gateway</html>', { status: 502 })],
    ['JSON in another shape', () => HttpResponse.json({ message: 'boom' }, { status: 500 })],
    ['an unknown error code', () => HttpResponse.json(errorBody('MYSTERY', 500), { status: 500 })],
  ])('maps %s to UNKNOWN', async (_label, respond) => {
    server.use(http.get(url('/thing'), respond));
    const error = await apiRequest('/thing').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'UNKNOWN' });
  });

  it('reports an unreachable server as NETWORK', async () => {
    server.use(http.get(url('/thing'), () => HttpResponse.error()));
    await expect(apiRequest('/thing')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('lets the caller cancel a request', async () => {
    server.use(
      http.get(url('/slow'), async () => {
        await delay(200);
        return HttpResponse.json({});
      }),
    );
    const controller = new AbortController();
    const pending = apiRequest('/slow', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.not.toBeInstanceOf(ApiError);
  });
});

describe('token refresh on 401', () => {
  it('refreshes once and retries the original request', async () => {
    let calls = 0;
    server.use(
      http.get(url('/data'), () =>
        ++calls === 1
          ? HttpResponse.json(errorBody('UNAUTHENTICATED', 401), { status: 401 })
          : HttpResponse.json({ n: 2 }),
      ),
      http.post(url('/auth/refresh'), () => new HttpResponse(null, { status: 204 })),
    );
    expect(await apiRequest('/data')).toEqual({ n: 2 });
    expect(calls).toBe(2);
  });

  it('signals an expired session and throws when the refresh fails', async () => {
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    server.use(
      http.get(url('/data'), () =>
        HttpResponse.json(errorBody('UNAUTHENTICATED', 401), { status: 401 }),
      ),
      http.post(url('/auth/refresh'), () =>
        HttpResponse.json(errorBody('UNAUTHENTICATED', 401), { status: 401 }),
      ),
    );
    await expect(apiRequest('/data')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(expired).toHaveBeenCalledOnce();
  });

  it('does not loop: a request that is still 401 after a successful refresh fails', async () => {
    let calls = 0;
    server.use(
      http.get(url('/data'), () => {
        calls++;
        return HttpResponse.json(errorBody('UNAUTHENTICATED', 401), { status: 401 });
      }),
      http.post(url('/auth/refresh'), () => new HttpResponse(null, { status: 204 })),
    );
    await expect(apiRequest('/data')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(calls).toBe(2);
  });

  it('shares one refresh between parallel requests (rotating tokens must not race)', async () => {
    const seen = new Map<string, number>();
    let refreshes = 0;
    server.use(
      http.get(url('/data/:id'), ({ params }) => {
        const id = String(params.id);
        seen.set(id, (seen.get(id) ?? 0) + 1);
        return seen.get(id) === 1
          ? HttpResponse.json(errorBody('UNAUTHENTICATED', 401), { status: 401 })
          : HttpResponse.json({ id });
      }),
      http.post(url('/auth/refresh'), async () => {
        refreshes++;
        await delay(30);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const results = await Promise.all(['a', 'b', 'c'].map((id) => apiRequest(`/data/${id}`)));
    expect(results).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(refreshes).toBe(1);
  });

  it.each([
    ['INVALID_CREDENTIALS', 401],
    ['FORBIDDEN', 403],
  ])('does not refresh for %s', async (code, status) => {
    let refreshes = 0;
    server.use(
      http.post(url('/auth/login'), () => HttpResponse.json(errorBody(code, status), { status })),
      http.post(url('/auth/refresh'), () => {
        refreshes++;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(apiRequest('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      code,
    });
    expect(refreshes).toBe(0);
  });

  it('skips the refresh entirely when asked (sign-in calls)', async () => {
    let refreshes = 0;
    server.use(
      http.post(url('/auth/login'), () =>
        HttpResponse.json(errorBody('UNAUTHENTICATED', 401), { status: 401 }),
      ),
      http.post(url('/auth/refresh'), () => {
        refreshes++;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(
      apiRequest('/auth/login', { method: 'POST', body: {}, skipRefresh: true }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(refreshes).toBe(0);
  });
});

describe('slow request detection (sleeping free-tier server)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useApiStatusStore.setState({ slowRequests: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flags a request that takes longer than the threshold and clears it afterwards', async () => {
    server.use(
      http.get(url('/slow'), async () => {
        await delay(SLOW_REQUEST_MS + 500);
        return HttpResponse.json({});
      }),
    );
    const pending = apiRequest('/slow');
    await vi.advanceTimersByTimeAsync(SLOW_REQUEST_MS + 100);
    expect(useApiStatusStore.getState().slowRequests).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(useApiStatusStore.getState().slowRequests).toBe(0);
  });

  it('does not flag fast requests', async () => {
    server.use(http.get(url('/fast'), () => HttpResponse.json({})));
    await apiRequest('/fast');
    expect(useApiStatusStore.getState().slowRequests).toBe(0);
  });
});
