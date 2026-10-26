# ADR 0021 — Feedback: praise and constructive feedback between colleagues

Status: accepted · Phase 3 step 3 · Builds on [ADR 0003](0003-roles-and-permissions.md), [0004](0004-notifications.md), [0007](0007-organization.md), [0011](0011-gdpr-export-erasure.md), [0020](0020-one-on-ones.md)

## Context

Colleagues should be able to **tell each other what went well and what could be better**, in writing, with a clear
answer to "who can read this". The permission catalog already has `feedback.give` (everybody, any colleague),
`feedback.view_received` (own / reports / HR all) and `feedback.moderate` (HR, Admin). Out of scope: anonymous feedback,
feedback requests ("please give me feedback"), edits of sent feedback, public praise walls, ratings, review cycles
(Phase 4), AI summaries.

## Decisions

### 1. Data (one table, RLS, composite `(tenant_id, id)` foreign keys)

`feedback`: `from_employee_id`, `to_employee_id` (different, both in the workspace), `kind` (`praise` /
`constructive`), `visibility` (`recipient` / `recipient_and_manager`), `body` (1–2000), `reported_at`, `kept_at`,
`created_at`. The database checks: different people, enum values, body length, and that a report cannot be both open and
closed (`reported_at` and `kept_at` are never both set).

Feedback is **named**: the recipient sees who wrote it. Anonymous feedback is not offered (it needs a decision about
moderation and re-identification that this step does not make).

### 2. Who may read what

| Reader                                                                                       | Sees                                                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| the giver                                                                                    | everything they gave                                                |
| the recipient (`feedback.view_received` at `own`)                                            | everything they received                                            |
| the recipient's manager (`feedback.view_received` at `reports`) and HR (`all`) through authz | only items with `visibility = recipient_and_manager`                |
| a moderator (`feedback.moderate`)                                                            | only items that a recipient has **reported**, until kept or removed |
| everybody else, Admin included                                                               | nothing                                                             |

The giver chooses the visibility when writing and cannot widen it later. An item the caller may not read is not
reachable: `404`.

### 3. Moderation without a back door

Moderators do not browse feedback. A **recipient reports** an item (once); only then does it appear for moderators, who
either **keep** it (closes the report, it cannot be reported again) or **remove** it. A giver can always remove their own
feedback. Removal by a moderator is audited (ids and the kind only, never the text).

### 4. API (`/feedback`)

`GET /feedback?box=received|given|reported&employeeId=` (paged): `received` for yourself (all) or for another person you
may read through `feedback.view_received` (only the shared-with-manager items); `given` yourself; `reported` for
moderators. `POST /feedback` (`feedback.give`), `DELETE /feedback/:id` (giver, or moderator for a reported item),
`POST /feedback/:id/report` (recipient), `POST /feedback/:id/keep` (moderator). Reads and the rest are `@Authenticated()`
and check the permission in the service.

### 5. Notifications, audit, privacy

- `feedback.received` to the recipient when somebody gives them feedback: the feedback id only. It does not say whether
  it is praise or constructive, nor who wrote it; the text is read in the app.
- Giving, reporting and keeping are not audited; **removal by a moderator** is.
- Export lists feedback the person gave and received (text, kind, the other person's name). Erasure deletes every
  feedback item the person gave or received.
- Deactivated people neither give nor receive; existing items stay until erasure.

### 6. Web

`/feedback` with three tabs: **Received**, **Given** and, for moderators, **Reported**; a form to give feedback (person,
kind, who may read it, text). Nav entry for `feedback.give` or `feedback.view_received`.

## Consequences

- A manager never sees private feedback about their people, and neither does HR; the only route to such text for a third
  party is the recipient reporting it.
- Because nothing can be edited, a typo means removing and writing again.
