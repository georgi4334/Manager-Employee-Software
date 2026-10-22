const SENSITIVE_PARAMS = new Set([
  'token',
  'code',
  'state',
  'password',
  'id_token',
  'access_token',
]);

/** Masks secret query parameter values (e.g. the Google callback's ?code=) before a URL is logged. */
export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;
  const params = new URLSearchParams(url.slice(queryStart + 1));
  let changed = false;
  for (const key of new Set(params.keys())) {
    if (SENSITIVE_PARAMS.has(key.toLowerCase())) {
      params.set(key, '[redacted]');
      changed = true;
    }
  }
  return changed ? `${url.slice(0, queryStart)}?${params.toString()}` : url;
}
