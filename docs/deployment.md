# Deployment runbook

Design and reasons: [ADR 0005](adr/0005-deployment.md). Do the setup once, in this order. Free tiers and region names
change, so confirm "EU / Frankfurt" and the free plan on each sign-up page.

## 1. Accounts and services

1. **Neon** — create a project in the Frankfurt region. Copy the **direct** (non-pooled) connection string of the owner
   role; this is `MIGRATION_DATABASE_URL`.
2. **Resend** — create an account, add and verify your sending domain (EU region), create an API key
   (`RESEND_API_KEY`). `MAIL_FROM` looks like `InTime <no-reply@your-domain.eu>`.
3. **Render** — New → Blueprint → this repository (`render.yaml`, region Frankfurt). Fill the `sync: false` variables
   (step 3). Copy the service's **Deploy Hook URL** (Settings) and its public URL (`API_ORIGIN`).
4. **Cloudflare Pages** — create a Direct Upload project (no Git integration; the pipeline deploys). Note its name
   and URL (`WEB_ORIGIN`, e.g. `https://intime.pages.dev`). In the project settings → Variables add
   `API_ORIGIN` = the Render URL (production). Create an API token with "Cloudflare Pages: Edit" and note the account id.

## 2. Database (once)

```bash
openssl rand -base64 24   # run twice: app and system password (letters/digits are safest in URLs)
psql "$MIGRATION_DATABASE_URL" -v app_password='…' -v system_password='…' -f ops/bootstrap-db.sql
```

Runtime URLs are the same host and database as the owner URL with the role names `intime_app` / `intime_system` and
their passwords, keeping `?sslmode=require`:

```
DATABASE_URL=postgresql://intime_app:<pw>@<neon-direct-host>/<db>?sslmode=require
SYSTEM_DATABASE_URL=postgresql://intime_system:<pw>@<neon-direct-host>/<db>?sslmode=require
```

Rotating a password = re-run the script with a new one and update the Render variable.

## 3. Render environment variables

`DATABASE_URL`, `SYSTEM_DATABASE_URL` (above), `JWT_ACCESS_SECRET` (`openssl rand -base64 48`, different from every
other environment), `WEB_APP_URL` (= `WEB_ORIGIN`), `RESEND_API_KEY`, `MAIL_FROM`. Optional Google sign-in: create an
OAuth client, redirect URL `<WEB_ORIGIN>/api/v1/auth/google/callback`, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URL`. Optional AI assistant: `AI_KEY_ENCRYPTION_KEY` (32 random bytes, base64: `openssl rand -base64 32`) lets people and admins store provider keys; keep a copy, losing it makes stored keys unreadable (they must be entered again). Optional public holidays for the calendar (Bulgaria, Germany, England) come from openholidaysapi.org by default (free, no key, outbound HTTPS only); `PUBLIC_HOLIDAYS_FEED=false` switches that off and the calendar then uses its built-in Bulgarian and German days (ADR 0035). Optional reminders (forgotten check-outs and timers): `REMINDERS_TOKEN`
(`openssl rand -base64 48`); without it the hook does not exist. The other variables come from `render.yaml`.

## 4. GitHub

Settings → Environments → create `production`. Secrets: `MIGRATION_DATABASE_URL`, `RENDER_DEPLOY_HOOK_URL`,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Repository variables: `API_ORIGIN`, `WEB_ORIGIN`, `CF_PAGES_PROJECT`,
and last `DEPLOY_ENABLED=true`. Reminders (optional, `.github/workflows/reminders.yml`, hourly): secret
`REMINDERS_TOKEN` (same value as on Render) and variable `REMINDERS_URL` (= `API_ORIGIN`); the workflow does nothing while
`REMINDERS_URL` is empty. Protect `main` (PR + passing CI). Merging `dev` → `main` then deploys.

## 5. First workspace (once, after the first deploy)

From your machine with the production variables in `apps/api/.env` (never commit it):

```bash
pnpm --filter @intime/api build
pnpm --filter @intime/api tenant:create --name "Acme" --slug acme --admin-email you@your-domain.eu
```

The admin receives an invitation email; open the link, set a password.

## Operations

- **Slow first request** is normal (API and database wake up); the app shows a banner.
- **Logs**: Render dashboard (structured JSON, request ids, no personal data).
- **Rollback**: Render → Deploys → redeploy the previous one. Migrations are backward compatible, so the old code
  still works with the new schema; never edit a migration that has been deployed.
- **Failed deploy workflow**: fix forward or re-run it (workflow_dispatch); steps are idempotent.
- **Open items**: scheduled database backups, error monitoring, custom domain + SPF/DKIM.
- **Reminders**: the `Reminders` workflow calls `POST /api/v1/internal/reminders/run` every hour (it also wakes the
  free API). Check its runs in GitHub → Actions; a `401` means the two `REMINDERS_TOKEN` values differ, a `404` that
  Render has none. Each record is reminded once.
