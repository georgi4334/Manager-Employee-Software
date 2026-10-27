# ADR 0029 — Calendar event reminders

Status: accepted · Phase 5 · Builds on [ADR 0028](0028-calendar-advanced.md), [0017](0017-integrations.md), [0004](0004-notifications.md)

## Context

ADR 0028 left reminders for later because they are time-based. ADR 0017 already added the pattern: an hourly sweep
(`RemindersService`, run by the worker while the API is active and by the external pinger), with "once" stored in the
database. Events reuse it. **Granularity is one hour**, because that is how often the free tier can be woken; the choices below
are therefore whole hours and the page says so.

## Decisions

### 1. One reminder per event, chosen by whoever may change it

- `calendar_event.reminder_minutes` (nullable): `60` (one hour before) or `1440` (one day before); `null` = no reminder
  (default). Constants `EVENT_REMINDER_CHOICES` in contracts. A check constraint allows a value only on **personal and team**
  events (company events would remind everybody and are too noisy). The value belongs to the event or series: all
  occurrences use it; a "this occurrence" copy inherits it.
- Set in the create and update requests (`reminderMinutes`, nullable on update). Nobody sets a reminder on somebody else's
  behalf beyond what they may already change (`mayManage`).

### 2. Who is reminded

- Personal event: the organizer and every guest who has **not declined**. Team event: the lead and members. Only active
  people with an account. The notification is `calendar.reminder` (in-app and e-mail, preferences apply, same locked-channel
  rules as other notifications).
- Params: event id and the occurrence date only (never title, place or guests). The e-mail carries no details (ADR 0004).

### 3. When, and exactly once per occurrence

- The start instant of an occurrence is its local date plus the series' local start time in the workspace zone
  (`zonedToUtc`); an all-day event starts at 00:00 on its start date. A reminder is due when
  `start − lead ≤ now < start`. An occurrence that has already started is never reminded (a late sweep does not send
  stale reminders); an event created inside its lead window is reminded at the next sweep.
- "Once" is stored: `calendar_reminder` (RLS, composite foreign key to the event, cascade) with a unique
  `(tenant_id, event_id, occurrence_date)`. The sweep claims an occurrence with `INSERT … ON CONFLICT DO NOTHING` inside the
  transaction that queues the notifications, so two runs or two servers cannot both send.
- Changing the time or date of an event or series deletes its claims, so the new time gets a reminder. Cancelled occurrences
  (exceptions) and deleted events are never reminded.
- The sweep looks at the next two days only (the largest lead is one day) and at most 500 events per workspace and run.

### 4. Privacy

- The claim table holds only ids and a date (no personal data) and disappears with the event. Notifications are ids only.
  Erasure of a person already deletes their personal events and invitations (ADR 0028); team events keep their reminder.

### 5. Web

- The event form gets **Reminder** (None / 1 hour before / 1 day before) for personal and team events, with a hint that
  reminders go out with the hourly check. Rows show the setting. Notification text and settings entry in en/de/bg.

### 6. Out of scope

Per-person reminders, several reminders per event, minute-level leads, push/SMS, reminders for 1:1s and leave.
