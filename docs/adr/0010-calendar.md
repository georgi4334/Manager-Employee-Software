# ADR 0010 — Calendar (basic: events, leave and holiday layers)

Status: accepted · Phase 1 step 5 · Builds on [ADR 0003](0003-roles-and-permissions.md), [0007](0007-organization.md), [0008](0008-leave.md)

## Context

People need one place to see what happens: their own appointments, team and company events, who is on leave and
the public holidays. Phase 1 is deliberately small. **Out of scope until Phase 4:** recurrence, sharing with
individual people, invitations/RSVP, reminders, find-a-time, several calendars per user, ICS, birthdays (personal
data).

## Decisions

### 1. Events are the only new data; layers are not stored

Leave and holidays already have scoped, masked endpoints (`GET /leave/requests`, `GET /leave/holidays`: sick types
hidden from colleagues, scope applied). The calendar page **reads those and merges them client-side** as read-only
layers. The server never copies leave into events, so a decision about leave can never leave a stale calendar entry
and the sick-leave masking rules exist in exactly one place.

### 2. Data model (`calendar_event`, tenant-scoped, RLS)

`scope` (`personal` / `team` / `company`), `owner_employee_id` (who created it; for `personal` the only person who
sees it), `team_id` (only for `team`, composite FK, cascades when the team is deleted), `title` (≤ 120),
`description` (≤ 1000), `location` (≤ 200), `all_day`, `start_date`/`end_date` (local calendar dates, **always
set**, end inclusive), `starts_at`/`ends_at` (instants, only for timed events), timestamps.

Database checks: all-day events have no instants; timed events have both and `ends_at > starts_at`;
`end_date >= start_date`; at most 31 days; `team_id` present exactly when `scope = 'team'`. Keeping local dates next
to the instants makes range queries plain date comparisons (no time-zone or DST arithmetic in SQL). Times are typed
as `HH:MM` in the workspace time zone like attendance (a time inside a DST gap is `nonexistent_time`).

### 3. Who sees and who changes what (`/api/v1/calendar/events`)

| Scope      | Sees                                                                                           | Creates / changes / deletes                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `personal` | only the owner                                                                                 | the owner (`calendar.manage_own`)                                                                           |
| `team`     | members and lead of that team, and people with `calendar.manage_team_calendars` at scope `all` | `calendar.manage_team_calendars`: scope `all` any team; otherwise only teams the person leads or belongs to |
| `company`  | everybody with `calendar.manage_own` (every role)                                              | `calendar.manage_company_calendar` (Admin, HR)                                                              |

A person who cannot see an event gets `404`, not `403` (existence is not revealed). The server is the only
authority; `canEdit` in responses is computed for the caller.
`GET /events?from&to` returns visible events overlapping the period (at most 93 days), ordered by start.
Team and company changes are audited (ids and action only, never titles); personal changes are not. There are
no notifications in this step (invitations arrive with Phase 4).

### 4. Web

"Calendar" page, 375 px first: views **Month** (grid with markers; tapping a day lists it), **Week** and **Day**
(stacked day sections, all-day first), **Agenda** (next days as a list; default on narrow screens). Layer toggles:
Mine, Team, Company, Leave, Holidays (the last two follow the viewer's permissions). Create/edit form in the page
(no modal), delete with confirmation. All strings en/de/bg.

## Update: time grid and weekends (2026-10)

- Weeks start on Monday everywhere. Saturday and Sunday are tinted (`bg-surface-muted`) in the
  month grid and the time grid, so the weekend stands out; the tint is decoration only.
- On wider screens (`md` and up) the week and day views are a time grid (hour rows, an all-day
  row, events placed by their local start and end, overlapping events side by side). Timed events
  that span midnight are cut per day. Below the grid the list of the selected day keeps the full
  details and actions (edit, delete, answer), which are also the accessible representation; the
  blocks in the grid are visual only (`aria-hidden`). Phones keep the day list.
- Today is a filled orange pill in the headers; a red line (`--danger`) marks the current time in
  today's column, with the time in the gutter, in the workspace time zone, updated every 30 s.
- The month grid shows up to two event titles per day on wider screens (+N for more); phones keep
  the dots. Layout of overlapping blocks is the pure `layoutDay` (`features/calendar/time-grid.ts`).

## Consequences

- No calendar/share/attendee tables yet: Phase 4 adds them and migrates `calendar_event` (expand, then contract).
- Personal data: events can contain whatever people type; titles stay out of audit logs and notifications.
  Erasure of an employee includes their personal events (Phase 1 hardening).

## Update: event cards

- Items in the day, week and agenda lists are cards: a left edge and the date block in the colour of
  the kind (personal `--primary`, team `--info`, company `--success`, leave `--warning`, holiday
  `--accent-foreground`), the title large, a meta line (kind, team, repeat, reminder, place) with small
  icons, the description, and on the right the day number, the month in capitals and the time with a
  clock. Colour is never the only signal: the kind is also written out.

## Update: opening an item

- Clicking an item opens it in a dialog (`EventDialog`, built on the shared `Modal`) in **every**
  view: the cards of the day/week/agenda lists (the whole card is the button), the titles inside the
  month days on wide screens (the day cell is a focusable grid cell with real buttons inside; Enter
  selects the day), and the blocks of the week/day time grid. The time grid is a picture
  (`aria-hidden`): keyboard and screen-reader users open items from the list below it.
- Everybody who can see an item can read its details there: day and time, team, repeat, reminder,
  place, description, the organizer and the guests with their answers. A guest answers (RSVP) in the
  dialog. Edit and Delete appear only when the server says `canEdit` (owner, team rights, company
  rights, administrators as in this ADR); otherwise the dialog says the event can be seen but not
  changed. A colleague's leave and a holiday open read-only with a short note (the leave type and
  reason masking is unchanged: the dialog uses the same item the list shows).
- Editing happens inside the dialog (the form replaces the details and returns to them after saving);
  deleting asks for confirmation and, for a series, which events, then closes the dialog.
