# ADR 0028 — Calendar, advanced: recurrence, invitations and find-a-time

Status: accepted · Phase 5 · Builds on [ADR 0010](0010-calendar.md), [0004](0004-notifications.md), [0008](0008-leave.md), [0026](0026-working-hours.md)

## Context

ADR 0010 left recurrence, sharing, invitations/RSVP, find-a-time and reminders for later. This step adds the first three.
**Reminders are the next step** (they need time-based delivery, which on the free tier means the hourly sweep; they get their
own ADR section when built). ICS import/export, several calendars per person, rooms and per-occurrence RSVP are out of scope.

## Decisions

### 1. Recurrence (a deliberately small RRULE subset)

- A series is **one `calendar_event` row** with a rule: `recurrence_freq` (`daily` / `weekly` / `monthly` / `yearly`),
  `recurrence_interval` (1–30), `recurrence_weekdays` (weekly only, Monday = 0, empty = the weekday of the start),
  and an optional end: `recurrence_until` (a date) **or** `recurrence_count` (1–500), or neither (open-ended).
- Monthly and yearly repeat on the start's day of the month; a day that does not exist (31st, 29 February) becomes the last day
  of that month. No "second Tuesday", no hours-level repetition.
- **Occurrences are expanded at read time** inside the requested window (at most 93 days; at most 366 occurrences per series
  and window) by pure, tested functions in contracts (`occurrenceStarts`). Nothing is generated or stored per occurrence. A
  multi-day event keeps its length for every occurrence (still at most 31 days); the start time of day is the series'.
- Editing and deleting a series offers Google-style scopes through `?mode=` and `?occurrence=YYYY-MM-DD`:
  - `all` (default): change or delete the whole series.
  - `this`: the occurrence is **cancelled** (`calendar_event_exception`, one row per cancelled date); an edit also creates a
    one-off event with the changes (a copy of the guests, answers reset).
  - `following`: the old series ends the day before (`recurrence_until`; if it was the first occurrence the series is deleted)
    and a new series starts at the occurrence with the changes (guests copied, answers reset).
- Occurrences carry local dates and times only (no instant is stored per occurrence), so a series keeps its local time across
  daylight-saving changes.

### 2. Invitations and answers (this is how an event is shared with specific people)

- `calendar_attendee` (RLS, composite foreign keys): `event`, `employee`, `response` (`needs_action` / `accepted` /
  `declined` / `tentative`), `responded_at`. The organizer is the owner (no row). Answers apply to the **whole series**.
- Guests only on **personal-scope** events (team and company events are already visible to their audience). At most 50
  guests; only active employees of the workspace; not the organizer; no duplicates (`CONFLICT`, `field: attendee`).
- Visibility: a personal event with guests is visible to the owner **and its guests**; for everybody else it is `404`. Guests
  read it (including the guest list with answers, as in Google Calendar), answer with `PUT /events/:id/response`, and cannot
  change or delete it. The organizer changes the guest list through the event update (`attendeeIds`, replace semantic).
- Notifications (ids only, never titles or names): `calendar.invited` (to a new guest), `calendar.response` (to the
  organizer: the event, the date and the answer), `calendar.changed` (to guests when the time changes or the event/series is
  cancelled). Answering notifies the organizer once per change of answer. Guests removed from the event are told nothing.
- Deactivation keeps invitations (history). Erasure of an employee deletes their invitations; their organized personal events
  (and so the invitations to them) are deleted too (ADR 0011). Export lists organized events with guest answers and the
  invitations the person received (title, date, own answer).

### 3. Find-a-time

- `POST /calendar/find-time` (`calendar.manage_own`) with up to 20 people, a period of at most 14 days and a duration of 15–480
  minutes returns **up to 10 suggested slots**, earliest first, where **everybody is free**: slots only, never the reason for
  busy time and never a per-person breakdown (free/busy, not content).
- A person is **unavailable** on a day when it is a weekend or public holiday of their country, a day off in their working hours
  (ADR 0026), an approved leave day (any fraction: half-days are skipped to stay simple), or before their hire / after their
  termination date. Within an available day the common window is **09:00–18:00 workspace time** (a product default), and a
  person is **busy** during timed events they organize or have not declined, timed company events, and timed events of their
  teams. All-day events block nobody.
- Slots start on a 30-minute grid. The pure function `findSlots` lives in contracts; the API gathers the busy intervals.

### 4. Permissions and privacy

- No new permission: `calendar.manage_own` (every role) covers inviting, answering and find-a-time. The server is the authority;
  an unknown or inactive employee id is `404`/`VALIDATION_FAILED`, never a hint about who exists in another workspace.
- Guest lists, answers and free/busy are personal data about presence: nothing is written to the audit log for personal events
  (ADR 0010), and notifications carry ids only.

### 5. Web

- The event form gets **Repeats** (none/daily/weekly/monthly/yearly, interval, weekdays, end), **Guests** (search by name) and, for
  recurring events, a choice of scope (this / following / all) when saving or deleting. Event rows show a repeat marker and the
  answer; guests get Accept / Maybe / Decline. **Find a time** is a panel in the form: pick guests and duration, choose a
  suggested slot to fill the date and times.

### 6. Out of scope

Reminders (next step), per-occurrence answers, "n-th weekday of the month", ICS, several calendars, rooms, external guests
(email invitations), time zones per event.
