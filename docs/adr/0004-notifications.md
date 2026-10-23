# ADR 0004 — Notifications (outbox, in-app inbox, email)

Status: accepted · Phase 0 step 8 · Builds on [ADR 0001](0001-multi-tenancy-rls.md) and [ADR 0003](0003-roles-and-permissions.md)

## Context

Features (leave, 1:1s, reviews, calendar, …) must be able to say "tell this person" without knowing how: an
in-app inbox with an unread badge, and email, in the user's language, respecting each person's preferences.
Constraints: free hosting (the API sleeps when idle; the database may suspend after a few idle minutes), a single
API instance, GDPR (no sensitive content in emails, retention), tenant isolation, solo maintenance.

## Decisions

### 1. Transactional outbox

A feature publishes an **event** in the _same database transaction_ as its change
(`OutboxService.publish(tx, 'account.roles_changed', params)`). Either both are saved or neither, so a
notification can never be lost or sent for a change that was rolled back. A background worker turns events
into notifications afterwards.

```
request tx ── change + outbox_event ──► commit ──► wake the worker
worker:  claim events → (tenant tx) create notification rows + mark event done
         claim emails → send → mark sent / retry later
```

### 2. No pg-boss (changes the earlier plan)

The queue is the outbox table itself, claimed with `FOR UPDATE SKIP LOCKED` plus a lease (`locked_until`), retries
with exponential backoff (`available_at`) and a dead state after 5 attempts. Reasons: one table serves as event log
and queue; it fits Row Level Security and the existing roles; no extra schema, no extra privileged database role,
fewer moving parts to run for free. Revisit pg-boss if scheduled/cron jobs at scale are needed.

### 3. The worker must not keep a free-tier database awake

Polling every few seconds would stop the database from ever suspending and burn the free compute quota. So:

- the worker runs **right after a commit that published an event** (`TenantDb.afterCommit`),
- once at startup (to finish what a previous run left over),
- and a slow sweep (every 30 s) **only while the API has served a request in the last 10 minutes**.
  Nothing polls an idle system. If the API sleeps with retries pending, they are delivered at the next wake-up.
  (Time-based features such as reminders will need an external pinger later; noted for the deployment step.)

### 4. Data model (all tenant-scoped, RLS)

- `outbox_event`: type, params (jsonb), status (`pending/processing/done/dead`), attempts, available_at,
  locked_until, last_error, created_at, processed_at. The application role may only **insert** events;
  reading and claiming is done by the system role (cross-tenant worker).
- `notification`: recipient_user_id, type, params, link, `in_app` (shown in the inbox?), read_at, and the email
  state (`email_status`: `none/pending/sending/sent/failed/skipped`, attempts, next attempt, sent_at). One row per
  person per event; it doubles as the email queue.
- `notification_preference`: user, type, channel (`in_app/email`), enabled.

Parameters contain **ids and non-sensitive labels only** (e.g. role names), never free text from people.
Display text is never stored: the web app translates `type` + `params` (en/de/bg); emails are rendered at send
time in the recipient's language.

### 5. Catalog and preferences

`@intime/contracts` (`notifications.ts`) lists the notification types with their parameter schema, default
channels and which channels a person may not switch off (`locked`, e.g. security-relevant types). Effective
channels = stored preference, else default, with locked channels forced on. Producers cannot send an
undefined type, and parameters are validated when published.

### 6. Delivery guarantees

- In-app: **exactly once** — notification rows and "event done" are written in one transaction.
- Email: **at least once** — sent outside the transaction, then marked; a crash in between can send twice.
  Only active users receive email; disabled/invited accounts are marked `skipped`.
- Emails contain a short localized text and a link to the app, **never** the details of the change.

### 7. API and web

`GET /notifications` (newest first, cursor), `GET /notifications/unread-count`,
`POST /notifications/:id/read`, `POST /notifications/read-all`, `GET/PUT /notifications/preferences`.
Inbox routes are `@Authenticated()` and always scoped to the caller; preferences need
`notification.manage_own_prefs`. The web bell polls the unread count every 60 s while the tab is visible
(and on focus) — robust against a sleeping server; server-sent events can replace it later without API changes.

### 8. Retention (GDPR)

During sweeps (at most hourly): read notifications older than 90 days and unread ones older than 180 days,
finished outbox events older than 30 days, dead events older than 90 days are deleted.

## Consequences

- Every future feature gets notifications by adding a type to the catalog (+ translations) and one `publish` call.
- Operations: nothing to schedule; `WORKER_ENABLED=false` turns the worker off (tests, one-off commands).
- First producer: changing someone's roles notifies that person (`account.roles_changed`).

## Not in this step

Daily digests, quiet hours, tenant-wide defaults (`notification.manage_tenant_defaults`), push notifications,
real email provider (the `Mailer` interface already exists; production needs one, step: deployment).
