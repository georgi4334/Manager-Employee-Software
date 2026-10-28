# ADR 0034: Customisable dashboard

Status: accepted

## Context

The home page should give each person a quick picture of their work, in the visual style of
ADR 0033, and an administrator should be able to decide what the workspace dashboard contains:
add, remove and reorder the building blocks. Every feature in the menu should be available.

## Decisions

- **One layout per workspace**, chosen by an administrator. It is an ordered list of widget ids,
  stored in `dashboard_layout` (RLS, one row per workspace, `widgets text[]`, at most 50; no row =
  the default layout). Nothing personal is stored: the table is not part of the data export or
  erasure.
- **The catalog is fixed in code**: `DASHBOARD_WIDGETS` in `@intime/contracts` (`dashboard.ts`).
  The API accepts only known ids, each once (`dashboardLayoutRequestSchema`); a stored id that
  later leaves the catalog is dropped when read (`normalizeLayout`).
- **Who may change it**: `admin.tenant.settings` (Admin only; "Workspace settings"), so no new
  permission. `GET /dashboard/layout` is `@Authenticated()` and answers `canEdit`;
  `PUT /dashboard/layout` and `DELETE /dashboard/layout` (back to the default) need the
  permission. Changes are audited (`dashboard.updated` with the widget ids, `dashboard.reset`).
- **Widgets read through the existing endpoints with the viewer's own rights.** The layout says
  _what may appear_; each person sees only widgets whose permission they hold (cosmetic, the
  server still decides every request), with the data their scope allows. A widget never
  widens what a person can see.
- **Look**: four coloured stat cards on top (icon tile, value, short note, a sparkline where a
  trend exists: hours this week, workload per day), then cards (lists of four with a "view all"
  link) and wide cards for charts (hours per day, workload per person, logged hours per week).
  Charts are hand-made SVG/CSS (no chart library); every value is also written as text, the
  graphic is `aria-hidden`.
- **Editing** happens on the page: "Customise" turns on edit mode with move up / move down /
  remove on each widget, an "Add widget" list and Save / Cancel / Reset. Buttons rather than drag
  and drop, so it works with the keyboard and on phones.

## Consequences

A new feature that wants a dashboard widget adds an id to `DASHBOARD_WIDGETS`, a component and
its permission in `features/dashboard/widgets.tsx`, and en/de/bg texts in `dashboard.json`.
