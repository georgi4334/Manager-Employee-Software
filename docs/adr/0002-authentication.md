# ADR 0002 — Authentication

Status: accepted · Phase 0 step 6 · Builds on [ADR 0001](0001-multi-tenancy-rls.md)

## Context

InTime is invite-only B2B software: HR/Admin invite employees; nobody signs up on their own.
People sign in with email + password or with Google. The same email may exist in more than one
workspace (tenant), e.g. a consultant working for two companies. Sessions must be revocable
immediately (disabled employee, password reset) and survive the free-tier cold starts.

## Decisions

### Accounts

- `app_user` is tenant-scoped (RLS): `email` is unique **per tenant**, stored lower-cased and trimmed.
  Status: `invited` → `active` → `disabled`.
- `auth_identity`: one row per sign-in method: `password` (argon2id hash) or `google` (Google `sub`).
- Child tables reference their parent by **(`tenant_id`, id)** composite foreign keys, so a row can never point
  at a user or session of another tenant (PostgreSQL foreign-key checks ignore RLS). Allowed values
  (status, provider, purpose) are enforced by check constraints.
- No self sign-up. The first workspace and its admin are created by the platform operator with the
  CLI (`pnpm --filter @intime/api tenant:create`), which prints the admin's invitation link.
  Inviting further users through the API arrives with RBAC (step 7).

### Passwords

- argon2id, OWASP parameters (m = 19 MiB, t = 2, p = 1) via `@node-rs/argon2` (prebuilt, no native build).
- 12–128 characters (upper bound prevents hashing-cost abuse), must not contain the email's local part.
- Unknown email → a dummy hash is still verified, so response time does not reveal which emails exist.

### Which workspace?

- Login takes `email`, `password` and an optional `workspace` (slug).
- Candidates = active users with that email (cross-tenant lookup, system role). The password is checked
  against each candidate. Only **after** a password matched more than one workspace does the API answer
  `409 TENANT_SELECTION_REQUIRED` with those workspaces, so the list never leaks to someone without the
  password. With `workspace` given, only that one is considered.

### Sessions and tokens

- A `session` row per sign-in: absolute lifetime 30 days, revocable.
- **Access token**: JWT (HS256, `jose`), 15 minutes, claims `sub` (user), `tid` (tenant), `sid` (session).
  Every request also checks that the session is not revoked and the user is still active (one indexed
  query, run as that tenant through `TenantDb`), so disabling a user or resetting a password logs them
  out immediately, not after 15 minutes.
- **Refresh token**: 32 random bytes, only its SHA-256 hash is stored (`refresh_token`), 14 days, never
  beyond the session's end. **Rotated** on every refresh. Re-use of an already-rotated token:
  - within 30 s → treated as a harmless race between browser tabs: 401, nothing revoked;
  - later → treated as theft: the whole session is revoked.
- Tokens travel only in **httpOnly cookies** (never readable by JavaScript, so XSS cannot steal them):
  `intime_at` (path `/api`) and `intime_rt` (path `/api/v1/auth`), `SameSite=Lax`, `Secure` in production.
- **Deployment requirement:** the web app and API must be _same-site_ (e.g. `app.example.eu` +
  `api.example.eu`, or the web host proxying `/api` to the API). Browsers block third-party cookies, so
  `*.pages.dev` + `*.onrender.com` would not work. Recorded for the deployment step.
- **CSRF**: `SameSite=Lax` plus an Origin check: state-changing requests carrying an `Origin` header not in
  `CORS_ORIGINS`/`WEB_APP_URL` are rejected with 403.

### One-time tokens (invitation, password reset)

- `auth_token` rows: purpose, SHA-256 hash, expiry (invite 7 days, reset 1 hour), `used_at`.
  Claimed atomically, so a link works exactly once. Raw tokens exist only in the email link.
- Accepting an invitation sets the password, activates the user and signs them in.
- Password reset: `forgot` always answers 202 (no account enumeration); `reset` sets the new password and
  revokes every session of that user.

### Google sign-in

- Authorization Code flow with PKCE, `state` and `nonce`, implemented with `jose` (verifies Google's
  ID token against Google's published keys: issuer, audience, expiry, nonce) instead of Passport: fewer
  moving parts and fully unit-testable.
- Google never creates accounts: it signs in an **existing** user (invited) whose email equals Google's
  **verified** email, linking the Google identity on first use.
- Optional: enabled only when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URL` are set.

### Abuse protection

- Per-IP rate limits (`@nestjs/throttler`, in memory — one API instance on the free tier) are deliberately
  generous because a whole office may share one IP: sign-in 60/min, refresh 120/min, invitation accept
  20/min, forgot-password 10 per 15 min, reset 20 per 15 min.
- Password guessing is slowed **per email**: 10 failed sign-ins in 15 minutes block that email (even with the
  right password) while colleagues on the same IP are unaffected.
- `TRUST_PROXY` (default on in production) makes the API read the client IP from the hosting proxy.

### Email

- `Mailer` interface, chosen by `MAIL_TRANSPORT`: `log` prints emails including links (development only),
  `memory` keeps them (tests), `disabled` drops them with a content-free warning. A delivering provider
  (EU region) arrives with notifications (step 8). Production refuses `log`/`memory`, so one-time links can
  never reach production logs. Emails are localized (en/de/bg) by the user's or workspace's locale.

### Logging

- Request logs never contain passwords, cookies, tokens or personal data: cookies/authorization headers are
  redacted, and secret query parameters (`token`, `code`, `state`, …) are masked in logged URLs.

### Secure by default

- A global guard requires authentication on every route; public routes opt out with `@Public()`.

## Consequences

- Login, refresh and token lookups use the system role (cross-tenant by nature); everything after the
  tenant is known runs through `TenantDb`.
- One small session query per authenticated request (fine at this scale; cacheable later).
- New env vars: `JWT_ACCESS_SECRET`, `WEB_APP_URL`, `MAIL_TRANSPORT`, optional `GOOGLE_*`, TTL overrides.
- The web login screens come next (step 6b), using these endpoints.

## Endpoints (`/api/v1/auth`)

| Method | Path                   | Purpose                                                 |
| ------ | ---------------------- | ------------------------------------------------------- |
| POST   | `/login`               | email + password (+ workspace) → cookies + current user |
| POST   | `/refresh`             | rotate tokens                                           |
| POST   | `/logout`              | revoke session, clear cookies                           |
| GET    | `/me`                  | current user                                            |
| POST   | `/invitations/inspect` | email + workspace name for an invitation token          |
| POST   | `/invitations/accept`  | token + password → active user, signed in               |
| POST   | `/password/forgot`     | email (+ workspace) → 202 always                        |
| POST   | `/password/reset`      | token + new password, revokes all sessions              |
| GET    | `/google/start`        | redirect to Google (optional `workspace`)               |
| GET    | `/google/callback`     | finish Google sign-in, redirect to the web app          |
