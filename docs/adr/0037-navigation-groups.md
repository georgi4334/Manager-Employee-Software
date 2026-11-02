# ADR 0037: Grouped side menu with the sections of the open page

Status: accepted (2026-11-02)

## Context

The side menu had grown to 19 flat entries for an administrator, in the order the modules were built: daily tools next to
administration, Employees and Organization at the very bottom. Several pages have sections (tabs such as Leave → Approvals) that
could only be reached by opening the page first.

Three options were mocked: section headings (A), collapsible groups (B) and headings plus the sections of the open page (A + C).
A + C was chosen: nothing is hidden, and the menu grows by a few short lines only for the page you are on.

## Decision

- Every menu entry belongs to one group, in this order: (no heading) Dashboard, Assistant · **My workday** Attendance, Leave,
  Calendar, Time · **Work** Projects, Tasks, Capacity · **People** Employees, Organization · **Growth** Goals, 1:1 meetings,
  Feedback, Skills, Reviews · **Insights** Analytics · **Administration** Roles, Data retention (set apart at the bottom).
  `NAV_GROUPS` and `NavItem.group` in `apps/web/src/app/nav.ts`. A group with no entry the user may open is not shown.
- **Sections are defined once**: `PAGE_SECTIONS` (`apps/web/src/app/sections.ts`) lists, per page, the query parameter
  (`tab`, or `box` for Feedback), the sections in order and who sees each (`visibleSections(path, granted)`, pure). The pages
  build their tab lists from it, and the menu shows the same list under the **active** entry only, when there is more than one.
  The first section is the page without a parameter. Pages: Attendance, Leave, Time, Projects, Organization, Feedback, Skills,
  Reviews, Assistant. View switches and filters (calendar views, task board, goal scopes, 1:1 status, analytics period) are not
  sections.
- Like every menu decision this is cosmetic: routes and the API still decide (ADR 0003).
- Phones keep the four bottom entries; the "More" sheet shows the remaining entries as tiles under the same group headings and
  scrolls.
- Accessibility: one `nav`; each group is a list labelled by its heading; the sections are a nested list labelled
  "Sections of <page>", the current one has `aria-current="page"`.

## Consequences

- A new page with tabs adds its sections to `PAGE_SECTIONS` (labels stay in the page's own `tabs.*` keys); a new menu entry
  names its group. Group names need en/de/bg texts in `nav.json` (`group*` keys).
- **Counts** next to sections (`useSectionCounts`, `apps/web/src/app/section-counts.ts`): Leave › Approvals (pending requests
  the user may decide), Time › Approvals (submitted weeks with `canDecide`; the user's own week never counts) and Feedback ›
  Reported (open reports for moderators). Each count reuses the request and cache of the section's own list, so a decision
  there updates the menu; only the open page asks. The number is decoration (`aria-hidden`); the link's name says
  "N waiting for you". Zero shows nothing; more than 99 shows "99+".
