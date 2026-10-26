# ADR 0020 — 1:1 meetings with shared notes, private notes and action items

Status: accepted · Phase 3 step 2 · Builds on [ADR 0003](0003-roles-and-permissions.md), [0004](0004-notifications.md), [0007](0007-organization.md), [0011](0011-gdpr-export-erasure.md)

## Context

A manager and each of their people meet one to one. They need a place for the **agenda**, **notes both may read**, **notes
only one may read**, and **action items** that carry over. The permission catalog already says: `one_on_one.manage` is for
participants only and **nobody, not even HR or an administrator, may read other people's 1:1 notes** (no permission exists
for it). Out of scope: recurring series, calendar events and reminders (Phase 5), templates, AI summaries, skip-level
meetings.

## Decisions

### 1. Participants

A meeting has exactly two participants: the **employee** and their **manager**, fixed when the meeting is made (the
employee's direct manager at that moment). Either may schedule it:

- an employee schedules a meeting with their own manager (`no_manager` if they have none),
- a manager schedules one with a direct report (`authz` on the report with `one_on_one.manage`, scope `reports`).

`one_on_one.manage` becomes `own` for Employee, `reports` for Manager, HR and Admin (they are employees too and have a
manager; `reports` also covers `own`). It is the only permission; it is **never** wider than the two participants.

### 2. Data (RLS, composite `(tenant_id, id)` foreign keys)

`one_on_one`: `manager_employee_id`, `employee_id`, `scheduled_at` (instant; typed as date + `HH:MM` in the workspace time
zone like attendance), `duration_minutes` (15–240, default 30), `status` (`scheduled` / `done` / `cancelled`), `agenda`
(≤ 1000), `shared_notes` (≤ 2000), `private_notes_manager` and `private_notes_employee` (≤ 2000 each).

`one_on_one_action_item`: `one_on_one_id`, `owner_employee_id` (one of the two participants, checked by a trigger),
`title` (≤ 120), `due_date` (optional), `done_at`. At most 20 per meeting.

The database checks the shapes (different participants, status, lengths, duration).

### 3. Who sees and does what

Only the two participants see a meeting; everybody else, including HR and Admin, gets **404**. A **private note** is
returned only to its author: the response carries `privateNotes` (the caller's own) and never the other's. Both may edit
agenda, shared notes, time and duration, mark the meeting done or cancelled, and add, change, complete or delete action
items. A cancelled meeting is locked (nothing but reading). Action items may be given to either participant.

### 4. API (`/one-on-ones`, all `@RequirePermission('one_on_one.manage')`)

`GET /one-on-ones?status=upcoming|past|all` (paged, upcoming = `scheduled`, ordered by time), `GET /one-on-ones/people`
(who the caller can schedule with: themself with their manager, and their direct reports), `GET /one-on-ones/:id`,
`POST /one-on-ones`, `PATCH /one-on-ones/:id`, `POST/PATCH/DELETE /one-on-ones/:id/action-items[/:itemId]`. The date and
time are validated as in attendance (`nonexistent_time`). An action item is always looked up through its own meeting.

### 5. Notifications, audit

`one_on_one.changed` to the other participant when a meeting is **scheduled, rescheduled or cancelled**: meeting id, date
and action only (never the agenda or notes). Notes and action items notify nobody. **No audit entries**: a 1:1 is a
conversation between two people, not an administrative action, and the audit log must not record it (as for personal
calendar events).

### 6. Lifecycle and privacy

- Deactivating an employee cancels their `scheduled` meetings (as employee or manager).
- Changing somebody's manager cancels their `scheduled` meetings with the former manager; past meetings stay with the two
  people who held them. The new manager starts fresh.
- Export lists the caller's meetings: agenda, shared notes, **their own** private notes and their action items.
- Erasure of an employee **deletes every meeting they took part in** (including the other person's private notes about
  them) with its action items; there is no statutory duty to keep them.

### 7. Web

`/one-on-ones` (upcoming / past, schedule form) and `/one-on-ones/:id` (when, agenda, shared notes, private notes marked
"only you can see this", action items with a check box). Nav entry for `one_on_one.manage`.

## Consequences

- Skip-level or HR-facilitated meetings are not possible; they would need a third participant and a decision about notes.
- Because the participants are fixed, an organisational change cannot silently give a new manager the old history.
