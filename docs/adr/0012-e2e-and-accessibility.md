# ADR 0012 — End-to-end tests and the accessibility gate

Status: accepted · Phase 1 step 7 (Hardening, part 2) · Builds on [ADR 0005](0005-deployment.md)

## Context

Unit, component and database integration tests cover the pieces. What they cannot show is that a **real browser**
talking to the **real API and database** completes the journeys people care about, and that every screen stays
usable for people with assistive technology. Both must be repeatable by one person and run in CI at no cost.

## Decisions

### 1. End-to-end happy paths (`e2e/`, Playwright, Chromium)

- Own workspace package `@intime/e2e` (not part of `pnpm test`, so the fast loop stays fast). `pnpm --filter @intime/e2e e2e` runs it.
- `scripts/start-api.mjs` is the test server: it recreates the database `intime_e2e` (owner URL from
  `E2E_DATABASE_URL`), runs the same role bootstrap and migrations as production, creates the workspace with the real
  `tenant:create` CLI, and runs the built API with the **log mail transport**. The tests read invitation links from the
  API log (the stand-in for an inbox), so the invitation flow is exercised for real, never bypassed.
- Specs run in order against one workspace (they build on each other, one worker): administrator onboarding and
  sign-in/out, language persistence; administrator invites an employee who joins; leave request → approval →
  notification; attendance clock and typed periods (including a refused overlap); personal and company calendar
  events with visibility checks; GDPR download, deactivation and erasure.
- Phone viewport (375 px) is the default. Failures keep a trace and a screenshot.
- Selectors are roles and visible labels, never CSS classes: the tests double as a check that controls are named.

### 2. Accessibility gate (axe, WCAG 2.1 A and AA)

`06-accessibility.spec.ts` scans **every page** (signed out and signed in, with the forms that only appear after
an action) at phone and desktop width, in light and dark mode, with `@axe-core/playwright`. Any violation fails the
run. Automated scans find roughly a third of the problems (contrast, names, roles, labels, landmarks, headings),
so manual criteria stay in the Definition of Done: keyboard operation, visible focus, 44 px touch targets,
no information by color alone, zoom to 200 %.

### 3. CI

A second job `e2e` (after `verify`) installs Chromium, builds the contracts and API and runs the suite against the
job's Postgres service. It runs on pushes and pull requests to `dev` and `main`; the HTML report is kept as an
artifact when it fails.

## Consequences

- One more workspace package and two dev dependencies (`@playwright/test`, `@axe-core/playwright`).
- E2E needs `psql` (preinstalled on GitHub runners and in the dev container) and a Postgres owner URL.
- Adding a page means adding it to the list in the accessibility spec.
