# ADR 0005 — Deployment (free EU hosting, one pipeline)

Status: accepted · Phase 0 step 9 · Builds on [ADR 0001](0001-multi-tenancy-rls.md), [0002](0002-authentication.md), [0004](0004-notifications.md)

## Context

InTime must run at no cost, in the EU (GDPR), maintained by one person. Free tiers sleep when idle, so the first
request after a pause is slow (cold start accepted; the web app already shows a "server is waking up" banner and
waits up to 65 s). Auth cookies are `httpOnly` and the CSRF defence checks the request origin, so browser and API
must look like **one site**.

## Decisions

| Part         | Choice                                             | Why                                                                                                |
| ------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Web (static) | Cloudflare Pages                                   | Free, global CDN (static files carry no personal data), supports Functions                         |
| `/api` proxy | Pages Function (`apps/web/functions/api`)          | Same origin for the browser; no wake-up timeout (Netlify rewrites give up after ~26 s)             |
| API          | Render free web service, Frankfurt (`render.yaml`) | EU region, Node runtime, sleeps when idle; deploys only through our pipeline (`autoDeploy: false`) |
| Database     | Neon free Postgres, Frankfurt                      | EU region, scales to zero. Direct (non-pooled) connection: one API instance, session settings      |
| Email        | Resend (EU sending region), HTTP API               | Free tier, no SMTP ports needed; `MAIL_TRANSPORT=resend`                                           |
| CI/CD        | GitHub Actions                                     | Free; `deploy.yml` runs after CI succeeds on `main`                                                |

Region and free-tier limits change: re-check them when creating the accounts (runbook: `docs/deployment.md`).

### Same-origin proxy

Browser → `https://<web>/api/*` → Pages Function → `https://<api>/api/*`. The function forwards cookies and the
`Origin` header unchanged, does not follow redirects (Google sign-in), refuses anything outside `/api/` and never
lets the client choose the target host. It replaces `X-Forwarded-For` with Cloudflare's `CF-Connecting-IP`; the API
therefore trusts **two** proxy hops (`TRUST_PROXY_HOPS=2`: Render's load balancer, then the function), so rate limits
see the visitor's address and a client cannot forge it. `WEB_APP_URL` is the Pages origin.

### Release order (on `main`, after CI is green)

1. `prisma migrate deploy` as the table owner (`MIGRATION_DATABASE_URL`, only available to the pipeline).
2. Trigger the Render deploy hook; the service builds, runs `roles:sync` (idempotent, keeps system-role grants in
   line with the permission catalog) and starts.
3. Deploy the web build and function to Pages.
4. Smoke tests: `GET /health/ready` on the API (retries wake it), `GET /` and `GET /api/v1/auth/me` (expects 401)
   on the web origin, which proves the proxy reaches the API.

Migrations run before the new code, so each migration must work with the **previous** release too (add columns/
tables first, remove or tighten in a later release). The pipeline does nothing until the repository variable
`DEPLOY_ENABLED` is `true`, so the repository stays green before accounts exist.

### Roles and secrets

The two runtime login roles are created once by `ops/bootstrap-db.sql` with generated passwords (the migrations only
create them as `NOLOGIN` when missing). Secrets live in the host dashboards and GitHub environment `production`
only: database URLs, `JWT_ACCESS_SECRET`, `RESEND_API_KEY`, Google credentials, Cloudflare token, deploy hook.
Nothing secret is in git; `render.yaml` marks them `sync: false`.

### Headers

`public/_headers` sets a strict Content-Security-Policy (the SPA loads only its own files), `X-Frame-Options: DENY`,
`nosniff`, a referrer policy and long-lived caching for hashed assets. The API sets its own headers with Helmet.

## Consequences

- Cold starts: API (~30–60 s) and database (a few seconds) after idle. Acceptable per project decision.
- Nothing keeps the API awake, so the notification worker only runs when someone uses the app (ADR 0004). Time-based
  features (reminders) will need an external pinger or scheduler; decide when the first one is built.
- Backups: the free database has short point-in-time recovery only. Before real customer data: scheduled `pg_dump`
  to EU storage (open item in the runbook).
- Single points to move later: each part is replaceable (Fly.io/Koyeb for the API, Supabase for the database,
  Brevo for email) because configuration is environment variables only.

## Not in this step

Custom domains and DKIM/SPF for the mail domain (needs a domain), error monitoring (Sentry EU), automated database
backups, preview environments, end-to-end tests against production.
