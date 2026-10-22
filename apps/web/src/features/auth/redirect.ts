/**
 * Where to go after signing in. Only same-site paths are allowed: "//evil.example" and
 * "https://evil.example" would turn the login page into an open redirect.
 */
export function safeRedirectPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || value.length > 2048) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  if (/^\/(login|forgot-password|reset-password|accept-invitation)(\/|\?|$)/.test(value))
    return fallback;
  return value;
}
