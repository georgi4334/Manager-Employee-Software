import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyToApi } from './api-proxy';

const API = 'https://intime-api.onrender.com';

function mockUpstream(response = new Response('{"ok":true}', { status: 200 })) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('proxyToApi', () => {
  it('forwards path, query, method, body and cookies to the API origin', async () => {
    const fetchMock = mockUpstream();
    const request = new Request('https://app.example.eu/api/v1/auth/login?x=1', {
      method: 'POST',
      body: '{"a":1}',
      headers: {
        cookie: 'intime_rt=abc',
        'content-type': 'application/json',
        origin: 'https://app.example.eu',
      },
      duplex: 'half',
    } as RequestInit);
    const response = await proxyToApi(request, API);

    expect(response.status).toBe(200);
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.href).toBe(`${API}/api/v1/auth/login?x=1`);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    const headers = init.headers as Headers;
    expect(headers.get('cookie')).toBe('intime_rt=abc');
    expect(headers.get('origin')).toBe('https://app.example.eu');
  });

  it('replaces any client-supplied forwarding headers with the real client address', async () => {
    const fetchMock = mockUpstream();
    await proxyToApi(
      new Request('https://app.example.eu/api/v1/me', {
        headers: {
          'x-forwarded-for': '6.6.6.6',
          'x-real-ip': '6.6.6.6',
          'cf-connecting-ip': '203.0.113.9',
        },
      }),
      API,
    );
    const headers = (fetchMock.mock.calls[0] as [URL, RequestInit])[1].headers as Headers;
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.9');
    expect(headers.get('x-real-ip')).toBeNull();
  });

  it('does not forward a spoofed address when Cloudflare supplied none', async () => {
    const fetchMock = mockUpstream();
    await proxyToApi(
      new Request('https://app.example.eu/api/v1/me', {
        headers: { 'x-forwarded-for': '6.6.6.6' },
      }),
      API,
    );
    const headers = (fetchMock.mock.calls[0] as [URL, RequestInit])[1].headers as Headers;
    expect(headers.get('x-forwarded-for')).toBeNull();
  });

  it('sends no body with GET requests', async () => {
    const fetchMock = mockUpstream();
    await proxyToApi(new Request('https://app.example.eu/api/v1/me'), API);
    expect((fetchMock.mock.calls[0] as [URL, RequestInit])[1].body).toBeUndefined();
  });

  it('passes redirects and Set-Cookie through untouched', async () => {
    const upstream = new Response(null, {
      status: 302,
      headers: {
        location: 'https://accounts.google.com/o/oauth2/v2/auth',
        'set-cookie': 'a=1; HttpOnly',
      },
    });
    mockUpstream(upstream);
    const response = await proxyToApi(
      new Request('https://app.example.eu/api/v1/auth/google'),
      API,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('accounts.google.com');
    expect(response.headers.get('set-cookie')).toBe('a=1; HttpOnly');
  });

  it('passes API error statuses through', async () => {
    mockUpstream(new Response('{}', { status: 401 }));
    expect((await proxyToApi(new Request('https://app.example.eu/api/v1/me'), API)).status).toBe(
      401,
    );
  });

  it.each([undefined, '', 'not a url', 'http://insecure.example.com'])(
    'answers 503 when API_ORIGIN is %j',
    async (origin) => {
      const fetchMock = mockUpstream();
      const response = await proxyToApi(new Request('https://app.example.eu/api/v1/me'), origin);
      expect(response.status).toBe(503);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('answers 502 when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    const response = await proxyToApi(new Request('https://app.example.eu/api/v1/me'), API);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'SERVICE_UNAVAILABLE' } });
  });

  it('cannot be steered to another host through the request path', async () => {
    const fetchMock = mockUpstream();
    await proxyToApi(new Request('https://app.example.eu/api//evil.example.com/x'), API);
    const [target] = fetchMock.mock.calls[0] as [URL];
    expect(target.origin).toBe(API);
  });

  it.each(['//evil.example.com/x', '/', '/apiary', '/other/api/v1'])(
    'refuses paths outside /api/ (%s)',
    async (path) => {
      const fetchMock = mockUpstream();
      const response = await proxyToApi(new Request(`https://app.example.eu${path}`), API);
      expect(response.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
