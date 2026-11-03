# ADR 0038: "Waiting for me" inbox

Status: accepted (2026-11-02)

## Context

Decisions a person owes are spread over five pages: leave approvals, timesheet approvals, review parts to write, reported
feedback to moderate and event invitations to answer. The menu counts (ADR 0037) only show while that page is open.
People asked for one place that lists everything waiting for them, with the usual actions at hand.

## Decision

- **Web only, no new tables or endpoints.** `/inbox` ("Waiting for me") reads the existing scoped lists with the user's own
  rights, so every rule stays where it is (nobody decides their own leave or week, scopes, masking, `404`s):
  - Leave: `GET /leave/requests?approvable=true` (pending requests the user may decide); Approve / Reject.
  - Timesheets: `GET /time/timesheets?status=submitted`, only items with `canDecide`; Approve / Reject.
  - Reviews: own self-reviews not submitted in **open** cycles (`box=mine`), and manager parts not submitted for people in
    the user's team (`box=team`, open cycles); "Write review" links to the review. Late ones (`*Overdue`) are marked.
  - Reported feedback (moderators): `GET /feedback?box=reported`; "Open" links to the Reported box (decisions there).
  - Invitations: events of the next 60 days where `myResponse = needs_action` (one row per event, not per occurrence);
    Accept / Maybe / Decline (`PUT /calendar/events/:id/response`).
    Each source is asked only when the user holds the permission behind it, and reuses the same query keys and caches as
    the pages, so a decision anywhere updates the inbox and the badge.
- **Order and grouping**: groups in the order above; inside a group the oldest first (leave by request date, weeks by
  submission, reviews late first, feedback by date, invitations by event date). Filter chips (All, Leave, Timesheets,
  Reviews, Feedback, Invitations) with counts; a group with nothing in it is not shown; an empty inbox says so.
- **Bulk**: leave requests and timesheets have checkboxes; a bar ("N selected · Approve N · Reject N · Clear") runs the
  same single requests one after another; rejecting asks for a confirmation; the result says how many worked and shows the
  first error. No bulk for reviews, feedback or invitations.
- **Menu**: "Waiting for me" sits under Dashboard (group `top`, no permission: everybody can have invitations or their own
  review) with the total as a badge. On phones it takes a bottom-bar slot (Dashboard, Waiting, Leave, Calendar, More;
  Attendance moves to "More"). The badge needs the lists on every page: they are cached for a minute.
- **Dashboard**: widget `waiting` (total and a line per kind with counts, link to the inbox), in the default layout.
- Accessibility: groups are labelled lists, actions are named with the person ("Approve leave of Eva Martin"), the badge
  number is decoration and the link says "N waiting for you".

## Consequences

- A new kind of decision joins by adding a source to `features/inbox/use-inbox.ts` (permission, query, row, action) and
  its texts in `inbox.json`.
- Up to six small list requests on app start for people with many permissions; acceptable, cached for a minute.
- Comments on reject are still given on the leave page (the inbox rejects without a comment, which the API allows).
