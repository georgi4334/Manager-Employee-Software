/**
 * Same-origin proxy for /api, run as a Cloudflare Pages Function (docs/adr/0005-deployment.md).
 * The browser only ever talks to the web origin, so auth cookies stay first-party and need no CORS; the
 * proxy has no body size or wake-up timeout of its own, which a sleeping free-tier API needs.
 */

/** Headers describing the visitor's connection; the API must only see the ones this proxy sets. */
const STRIPPED_REQUEST_HEADERS = ['host', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip'];

function json(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function proxyToApi(
  request: Request,
  apiOrigin: string | undefined,
): Promise<Response> {
  let origin: URL;
  try {
    origin = new URL(apiOrigin ?? '');
  } catch {
    return json(503, 'SERVICE_UNAVAILABLE');
  }
  if (origin.protocol !== 'https:') return json(503, 'SERVICE_UNAVAILABLE');

  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith('/api/')) return json(404, 'NOT_FOUND');
  // Concatenate instead of resolving: a path like "//host/x" would otherwise replace the API host.
  const target = new URL(`${origin.origin}${incoming.pathname}${incoming.search}`);

  const headers = new Headers(request.headers);
  for (const name of STRIPPED_REQUEST_HEADERS) headers.delete(name);
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) headers.set('x-forwarded-for', clientIp);

  try {
    return await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      // Redirects (Google sign-in) belong to the browser, not to this proxy.
      redirect: 'manual',
    });
  } catch {
    return json(502, 'SERVICE_UNAVAILABLE');
  }
}
