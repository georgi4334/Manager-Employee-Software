# InTime — Roadmap & Working Agreement

Solo developer + Claude, ~3–4 focused hours/day. Estimates are in **working days** (1 day ≈ 3–4 h) and assume steady progress; treat them as a guide, not a promise.

## Git workflow

- `main` — always deployable; updated only through a PR from `dev`.
- `dev` — integration branch; all feature work lands here (feature branches off `dev` are optional for bigger changes: `feat/<module>-<topic>` → PR into `dev`).
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- CI on every push/PR: lint → typecheck → unit tests → build. PR into `main` additionally runs integration + E2E.
- Recommended GitHub settings: protect `main` (require PR + passing CI), no direct pushes.

## Definition of Done (every feature)

- [ ] Unit tests: **positive and negative** (invalid input, forbidden role, wrong tenant, not found, duplicates, boundaries).
- [ ] Permission checks covered by the matrix test.
- [ ] Mobile-responsive (375 px) and no hard-coded colors (design tokens only).
- [ ] All strings translated: EN, DE, BG.
- [ ] Notifications/audit events emitted where relevant.
- [ ] GDPR check: personal data minimal, export/erase covered.
- [ ] Docs/ADR updated if a decision was made.

## Phase 0 — Foundation (~10–12 days)

1. Monorepo (pnpm + Turborepo), TS config, ESLint/Prettier, Husky + commitlint, GitHub Actions — **done**. _(1–2 d)_
2. `apps/web`: Vite + React 19 + React Router, Tailwind with `tokens.css` (neutral placeholder palette, light/dark), shadcn/ui base components, app shell (sidebar / mobile bottom nav), Vitest + RTL + MSW — **done**. _(2–3 d)_
3. i18n: react-i18next, EN/DE/BG namespaces, language switcher, missing-key check in CI — **done**. _(1 d)_
4. `apps/api`: NestJS, config validation, Prisma + Postgres (docker-compose locally), health check, error format with codes, OpenAPI — **done**. _(2 d)_
5. Tenancy: tenant context + RLS migration + isolation tests — **done** (ADR 0001). _(1–2 d)_
6. Auth: email/password (argon2id), Google OAuth, refresh rotation, invitations, password reset, throttling — **done** (ADR 0002). _(3 d)_
7. RBAC: roles/permissions seed from `packages/contracts`, guard, policies, matrix test — **done** (ADR 0003). _(2 d)_
8. Notification skeleton (outbox → in-app + email, ADR 0004) — **done**.
9. Deploy pipeline to free EU hosting + "API waking up" UI state (ADR 0005, `docs/deployment.md`) — **done** (accounts and secrets are set up by following the runbook).

## Phase 1 — First release (~25–30 days)

| Module           | Scope                                                                                                                                                               | Est.  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Employees        | CRUD, directory, profile, invite flow (avatar upload moves to the file-storage step, ADR 0006) — **done**                                                           | 4–5 d |
| Organization     | departments, teams, reporting lines, org chart, cycle prevention (ADR 0007) — **done**                                                                              | 3–4 d |
| Leave            | types/policies, balances, request → approve flow, holidays (BG/DE), notifications (ADR 0008) — **done**; project-conflict warnings arrive in Phase 2                | 6–7 d |
| Attendance       | manual check-in/out, office/remote/field, typed periods, corrections, history, team presence (ADR 0009) — **done**                                                  | 3–4 d |
| Calendar (basic) | month/week/day/agenda, personal/team/company events, leave + holiday layers, mobile agenda (ADR 0010) — **done**                                                    | 5–6 d |
| Notifications UI | bell, inbox, preferences, email templates (3 languages) — **done** (with ADR 0004)                                                                                  | 2–3 d |
| Hardening        | GDPR export/erase for employee data (ADR 0011), E2E happy paths and an accessibility gate (ADR 0012) — **done**; automated retention periods need a policy decision | 2–3 d |

## Phase 2 — Projects & Time (~30–35 days)

| Module             | Scope                                                                                                                                     | Est.  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Clients & Projects | clients, projects, milestones, staffing with allocation %, project dashboard (timeline, health) (ADR 0013) — **done**                     | 6–7 d |
| Tasks (lean)       | functional / non-functional tasks, assignee, estimate, due date, status, list + simple board (ADR 0014) — **done**                        | 5–6 d |
| Time Tracker       | start/stop timer, manual entries, billable flag, weekly timesheet, submit/approve/lock (ADR 0015) — **done**                              | 8–9 d |
| Time reports       | hours per project/person/client, budget vs actual, CSV export of approved hours (ADR 0016) — **done**; daily targets move to Integrations | 4–5 d |
| Integrations       | leave-conflict warnings on approval, attendance vs logged hours, missed check-out/timer reminders (ADR 0017) — **done**                   | 3–4 d |
| Capacity           | planned vs actual load, availability view (ADR 0018) — **done**                                                                           | 4–5 d |

Out of scope: payroll calculation, screenshots/activity monitoring, sprints/sub-tasks.

## Phase 3 — People growth (~20 days)

Goals (personal/team/company, key results) (ADR 0019) — **done**; 1:1 meetings (+ action items) (ADR 0020) — **done**; Feedback (ADR 0021) — **done**; Skills Matrix (ADR 0022) — **done**.

## Phase 4 — Insight & performance (~15–20 days)

Performance reviews (cycles, self/manager review, ratings, calibration) (ADR 0023) — **done**; Analytics dashboards (management view across HR + projects + time) (ADR 0024) — **done**.

## Phase 5 — Advanced (~20+ days)

AI assistant (BYOK, tool-calling, read-only) (ADR 0025) — **done**; calendar advanced (recurrence, invitations/RSVP, find-a-time; ADR 0028) — **done**; event reminders (ADR 0029) — **done**; per-person working hours + overtime (ADR 0026) — **done**; automatic GDPR retention for Bulgaria (ADR 0027) — **done**; role editor UI, compensation / hourly rates (HR + Admin), polish.

## Free-tier stack (EU) — to verify at setup time

| Need             | Choice (primary)                                           | Fallback            |
| ---------------- | ---------------------------------------------------------- | ------------------- |
| Frontend hosting | Cloudflare Pages / Netlify (static)                        | Vercel              |
| API              | Render (Frankfurt) free web service — cold starts accepted | Fly.io (fra), Koyeb |
| Database         | Neon (EU - Frankfurt) free                                 | Supabase (EU)       |
| Files            | Cloudflare R2 free (EU jurisdiction) / Supabase Storage    | —                   |
| Email            | Resend (EU region) or Brevo free                           | —                   |
| Errors           | Sentry (EU) free                                           | —                   |
| CI               | GitHub Actions                                             | —                   |

## Next immediate steps

1. Approve this documentation; open PR `dev` → `main` for `docs/`.
2. Start Phase 0, step 1 (monorepo + CI) in `dev`.
